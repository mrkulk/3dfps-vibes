const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 2000,  // More frequent ping for better latency detection
  pingTimeout: 5000    // Faster timeout for disconnected players
});

const PORT = 9001;
const WAIT_TIME = 30;
const ADMIN_KEY = 'admin-reset-key'; // Admin key for authentication

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Add an admin endpoint to reset rooms
app.post('/admin/reset-rooms', (req, res) => {
  const authHeader = req.headers.authorization;
  
  // Check if the admin key is valid
  if (authHeader === `Bearer ${ADMIN_KEY}`) {
    const resetCount = resetAllRooms();
    res.json({ success: true, message: 'All rooms have been reset', roomsReset: resetCount });
  } else {
    res.status(401).json({ success: false, message: 'Unauthorized' });
  }
});

let matches = [];

// Function to reset all rooms
function resetAllRooms() {
  console.log('Admin command: Resetting all rooms');
  
  // Notify all clients in each match
  matches.forEach(match => {
    io.to(match.id).emit('serverReset', { 
      message: 'The server is being reset. You will be disconnected.' 
    });
  });
  
  // Store the count of rooms that were reset
  const resetCount = matches.length;
  
  // Clear all matches
  matches = [];
  
  console.log(`Reset complete. ${resetCount} rooms were reset.`);
  return resetCount;
}

class Match {
  constructor(id) {
    this.id = id;
    this.players = {};
    this.greenTeam = [];
    this.redTeam = [];
    this.round = 0;
    this.greenScore = 0;
    this.redScore = 0;
    this.state = 'waiting';
    this.waitTimer = null;
    this.waitTimeLeft = WAIT_TIME;
    this.layout = this.generateRandomLayout();
    this.pendingHeads = {}; // Queue for head updates before players join
    this.headChanges = {}; // Track number of head changes per player
    this.lastUpdateTime = {}; // Track last update time for each player
    console.log(`Match ${this.id} created in waiting state`);
    this.startWaiting();
  }

  generateRandomLayout() {
    const layout = {
      walls: [],
      crates: [],
      bombsite: null
    };

    layout.walls.push({ type: 'box', width: 40, height: 3, depth: 1, x: 0, y: 1.5, z: -19.5, rotY: 0 });
    layout.walls.push({ type: 'box', width: 40, height: 3, depth: 1, x: 0, y: 1.5, z: 19.5, rotY: 0 });
    layout.walls.push({ type: 'box', width: 40, height: 3, depth: 1, x: -19.5, y: 1.5, z: 0, rotY: Math.PI / 2 });
    layout.walls.push({ type: 'box', width: 40, height: 3, depth: 1, x: 19.5, y: 1.5, z: 0, rotY: Math.PI / 2 });

    // Add some random crates
    for (let i = 0; i < 15; i++) {
      const x = Math.random() * 30 - 15;
      const z = Math.random() * 30 - 15;
      layout.crates.push({
        type: 'box',
        width: 1 + Math.random(),
        height: 1 + Math.random(),
        depth: 1 + Math.random(),
        x,
        y: 0.5 + Math.random(),
        z,
        rotY: Math.random() * Math.PI * 2
      });
    }

    // Add a bombsite
    const bombX = Math.random() * 10 - 5;
    const bombZ = Math.random() * 10 - 5;
    layout.bombsite = {
      type: 'plane',
      width: 10,
      height: 10,
      x: bombX,
      y: 0.01,
      z: bombZ,
      rotX: -Math.PI / 2
    };

    return layout;
  }

  startWaiting() {
    this.waitTimer = setInterval(() => {
      this.waitTimeLeft--;
      
      // Log less frequently to reduce console spam
      if (this.waitTimeLeft % 5 === 0 || this.waitTimeLeft <= 5) {
        console.log(`Match ${this.id} timer: ${this.waitTimeLeft}s, players: ${Object.keys(this.players).length}`);
      }
      
      if (this.state === 'waiting') {
        io.to(this.id).emit('waitingTimer', { 
          timeLeft: this.waitTimeLeft, 
          players: Object.keys(this.players).length,
          rooms: matches.length
        });
      }

      if (this.waitTimeLeft <= 0 && this.state === 'waiting') {
        const playerCount = Object.keys(this.players).length;
        if (playerCount === 1) {
          this.state = 'explore';
          io.to(this.id).emit('exploreMode', { layout: this.layout });
          clearInterval(this.waitTimer);
          console.log(`Match ${this.id} switched to explore mode`);
        }
      }
    }, 1000);
  }

  addPlayer(socketId, avatarRebirths = 0, totalWins = 0) {
    if (Object.keys(this.players).length >= 2) {
      console.log(`Match ${this.id} already has 2 players, rejecting ${socketId}`);
      return null;
    }

    // Deterministic team assignment
    const team = this.greenTeam.length === 0 ? 'green' : 'red';
    
    console.log(`Assigning player ${socketId} to team ${team}`);
    
    // Initialize player with complete data
    this.players[socketId] = {
      x: team === 'green' ? -14 : 14,
      z: team === 'green' ? -14 : 14,
      rotY: 0,
      team,
      health: 100,
      kills: 0,
      deaths: 0,
      meshUrl: this.pendingHeads[socketId] || null,
      avatarRebirths: avatarRebirths,
      totalWins: totalWins
    };
    
    // Add player to the appropriate team
    if (team === 'green') {
      this.greenTeam = this.greenTeam.filter(id => id !== socketId); // Remove if already exists
      this.redTeam = this.redTeam.filter(id => id !== socketId); // Ensure not in other team
      this.greenTeam.push(socketId);
    } else {
      this.redTeam = this.redTeam.filter(id => id !== socketId); // Remove if already exists
      this.greenTeam = this.greenTeam.filter(id => id !== socketId); // Ensure not in other team
      this.redTeam.push(socketId);
    }

    // Apply any pending head updates
    if (this.pendingHeads[socketId]) {
      console.log(`Applying pending head for ${socketId}`);
      delete this.pendingHeads[socketId];
    }
    
    // Initialize last update time
    this.lastUpdateTime[socketId] = Date.now();

    console.log(`Player ${socketId} added to match ${this.id}, team: ${team}, total players: ${Object.keys(this.players).length}`);
    console.log(`Teams - Green: ${this.greenTeam.length} players, Red: ${this.redTeam.length} players`);
    
    // Immediately send team assignment to client
    io.to(socketId).emit('teamSync', { team });
    
    // Broadcast updated player list to all clients
    this.broadcastPlayers();

    // Start the match if we have 2 players
    const playerCount = Object.keys(this.players).length;
    if (playerCount === 2 && (this.state === 'waiting' || this.state === 'explore')) {
      console.log(`Match ${this.id} starting 1v1 with 2 players from ${this.state}`);
      clearInterval(this.waitTimer);
      this.startMatch();
    }
    
    return team;
  }

  removePlayer(socketId) {
    if (!this.players[socketId]) {
      console.log(`Player ${socketId} not found in match ${this.id}`);
      return;
    }
    
    // Notify all clients that this player has left
    io.to(this.id).emit('playerLeft', { id: socketId });
    
    if (this.players[socketId].team === 'green') {
      this.greenTeam = this.greenTeam.filter(id => id !== socketId);
    } else if (this.players[socketId].team === 'red') {
      this.redTeam = this.redTeam.filter(id => id !== socketId);
    }
    
    delete this.players[socketId];
    delete this.lastUpdateTime[socketId];
    delete this.headChanges[socketId];
    
    console.log(`Player ${socketId} removed from match ${this.id}, remaining players: ${Object.keys(this.players).length}`);

    if (this.state === 'active' && Object.keys(this.players).length === 1) {
      const remainingPlayerId = Object.keys(this.players)[0];
      io.to(this.id).emit('opponentLeft', {
        message: 'Your opponent has left the match!',
        greenScore: this.greenScore,
        redScore: this.redScore,
        players: this.players
      });
      this.state = 'waiting';
      this.round = 0;
      this.greenScore = 0;
      this.redScore = 0;
      this.waitTimeLeft = WAIT_TIME;
      this.startWaiting();
      this.broadcastPlayers();
    } else if (Object.keys(this.players).length === 0) {
      clearInterval(this.waitTimer);
      matches = matches.filter(m => m.id !== this.id);
      console.log(`Match ${this.id} deleted (no players left)`);
    } else {
      // If there are still players, broadcast the updated player list
      this.broadcastPlayers();
    }
  }

  startMatch() {
    this.state = 'active';
    this.round = 1;
    
    // Reset player positions and health
    for (let socketId in this.players) {
      const player = this.players[socketId];
      player.x = player.team === 'green' ? -14 : 14;
      player.z = player.team === 'green' ? -14 : 14;
      player.health = 100;
    }
    
    io.to(this.id).emit('matchStart', { 
      matchId: this.id,
      layout: this.layout
    });
    
    this.broadcastPlayers();
    console.log(`Match ${this.id} started with ${Object.keys(this.players).length} players`);
  }

  endRound(killerId, victimId) {
    if (this.players[killerId].team === 'green') {
      this.greenScore++;
    } else {
      this.redScore++;
    }
    
    this.players[killerId].kills++;
    this.players[victimId].deaths++;
    
    this.round++;
    
    io.to(this.id).emit('roundEnd', {
      killer: killerId,
      victim: victimId,
      greenScore: this.greenScore,
      redScore: this.redScore,
      round: this.round
    });
    
    if (this.round > 5 || this.greenScore > 2 || this.redScore > 2) {
      this.endMatch();
    } else {
      setTimeout(() => {
        for (let socketId in this.players) {
          const player = this.players[socketId];
          player.x = player.team === 'green' ? -14 : 14;
          player.z = player.team === 'green' ? -14 : 14;
          player.health = 100;
        }
        
        io.to(this.id).emit('roundStart', { round: this.round });
        this.broadcastPlayers();
      }, 3000);
    }
  }

  endMatch() {
    const winner = this.greenScore > this.redScore ? 'green' : 'red';
    const winnerIds = winner === 'green' ? this.greenTeam : this.redTeam;
    
    // Update win counts for the winners
    winnerIds.forEach(id => {
      if (this.players[id]) {
        this.players[id].totalWins = (this.players[id].totalWins || 0) + 1;
      }
    });
    
    io.to(this.id).emit('matchEnd', {
      greenScore: this.greenScore,
      redScore: this.redScore,
      players: this.players,
      winner: winner,
      winnerIds: winnerIds
    });
    
    console.log(`Match ${this.id} ended, winner: ${winner}`);
    
    // Clean up the match after a delay
    setTimeout(() => {
      for (let socketId in this.players) {
        io.sockets.sockets.get(socketId)?.leave(this.id);
      }
      matches = matches.filter(m => m.id !== this.id);
      console.log(`Match ${this.id} cleaned up`);
    }, 5000);
  }

  broadcastPlayers() {
    // Make sure all player data is complete
    for (const socketId in this.players) {
      // Ensure team is set
      if (!this.players[socketId].team) {
        this.players[socketId].team = this.greenTeam.includes(socketId) ? 'green' : 'red';
      }
      
      // Ensure health is set
      if (this.players[socketId].health === undefined) {
        this.players[socketId].health = 100;
      }
      
      // Ensure position is set
      if (this.players[socketId].x === undefined || this.players[socketId].z === undefined) {
        const team = this.players[socketId].team;
        this.players[socketId].x = team === 'green' ? -14 : 14;
        this.players[socketId].z = team === 'green' ? -14 : 14;
      }
    }
    
    // Log less frequently to reduce console spam
    if (Math.random() < 0.1) {
      console.log(`Broadcasting players for match ${this.id}:`, Object.keys(this.players));
    }
    
    // Send the complete player data to all clients
    io.to(this.id).emit('playersUpdate', {
      players: this.players,
      greenTeam: this.greenTeam,
      redTeam: this.redTeam,
      greenScore: this.greenScore,
      redScore: this.redScore,
      round: this.round,
      state: this.state
    });
    
    // Also send individual updates for each player to ensure they're rendered
    for (const socketId in this.players) {
      io.to(this.id).emit('update', {
        id: socketId,
        ...this.players[socketId]
      });
    }
    
    if (this.state === 'waiting') {
      io.to(this.id).emit('waiting', { 
        players: Object.keys(this.players).length, 
        needed: 2,
        rooms: matches.length
      });
    }
  }

  updateHead(socketId, meshUrl) {
    // Increment head changes counter
    this.headChanges[socketId] = (this.headChanges[socketId] || 0) + 1;
    
    if (this.players[socketId]) {
      // Update the player's mesh URL
      this.players[socketId].meshUrl = meshUrl;
      this.players[socketId].avatarRebirths = this.headChanges[socketId];
      
      // Broadcast the head update to all players in the match
      io.to(this.id).emit('updateHead', { 
        id: socketId, 
        meshUrl,
        avatarRebirths: this.headChanges[socketId]
      });
      
      // Also send a regular update to ensure all clients have the latest player data
      io.to(this.id).emit('update', { 
        id: socketId, 
        ...this.players[socketId]
      });
      
      console.log(`Head updated for ${socketId} in match ${this.id}, rebirth count: ${this.headChanges[socketId]}`);
      
      // Broadcast full player data to everyone
      this.broadcastPlayers();
    } else {
      // Queue the head update for when the player joins
      this.pendingHeads[socketId] = meshUrl;
      console.log(`Head update queued for ${socketId} in match ${this.id}`);
    }
  }
  
  updatePlayer(socketId, data) {
    if (!this.players[socketId]) return;
    
    const now = Date.now();
    const timeSinceLastUpdate = now - (this.lastUpdateTime[socketId] || 0);
    
    // Update the player's data
    this.players[socketId] = {
      ...this.players[socketId], // Keep existing data
      x: data.x !== undefined ? data.x : this.players[socketId].x,
      z: data.z !== undefined ? data.z : this.players[socketId].z,
      rotY: data.rotY !== undefined ? data.rotY : this.players[socketId].rotY,
    };
    
    // If meshUrl is provided, update it
    if (data.meshUrl) {
      this.players[socketId].meshUrl = data.meshUrl;
    }
    
    // Update the last update time
    this.lastUpdateTime[socketId] = now;
    
    // Broadcast the update to all clients in the match
    // Use a more efficient update that only includes changed properties
    const update = {
      id: socketId,
      x: this.players[socketId].x,
      z: this.players[socketId].z,
      rotY: this.players[socketId].rotY
    };
    
    // Only include meshUrl if it was provided
    if (data.meshUrl) {
      update.meshUrl = data.meshUrl;
    }
    
    io.to(this.id).emit('update', update);
    
    // Periodically broadcast full player data (every ~5 seconds)
    if (timeSinceLastUpdate > 5000 || Math.random() < 0.02) {
      this.broadcastPlayers();
    }
  }
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);
  
  // Check if this is an admin connection
  const isAdmin = socket.handshake.query.isAdmin === 'true';
  const adminKey = socket.handshake.query.adminKey;
  
  // Handle admin commands
  if (isAdmin && adminKey === ADMIN_KEY) {
    console.log('Admin connected:', socket.id);
    
    socket.on('adminResetRooms', () => {
      const resetCount = resetAllRooms();
      socket.emit('adminResetResponse', { 
        success: true, 
        message: 'All rooms have been reset', 
        roomsReset: resetCount 
      });
    });
    
    return; // Skip regular player setup for admin connections
  }

  socket.on('join', (data = {}) => {
    // Check if this socket ID is already in a match
    const existingMatch = matches.find(m => m.players[socket.id]);
    if (existingMatch) {
      console.log(`Player ${socket.id} is already in match ${existingMatch.id}, rejoining`);
      
      // Re-join the existing match room
      socket.join(existingMatch.id);
      
      // Send the team information
      const team = existingMatch.players[socket.id].team;
      socket.emit('team', team);
      
      // Send complete player data
      socket.emit('init', existingMatch.players);
      
      // If in explore mode, send the layout
      if (existingMatch.state === 'explore') {
        socket.emit('exploreMode', { layout: existingMatch.layout });
      } else if (existingMatch.state === 'active') {
        socket.emit('matchStart', { 
          matchId: existingMatch.id,
          layout: existingMatch.layout
        });
      }
      
      return;
    }
    
    // Find or create a match for the player
    let currentMatch = matches.find(m => (m.state === 'waiting' || m.state === 'explore') && Object.keys(m.players).length < 2);
    if (!currentMatch) {
      currentMatch = new Match(`match_${matches.length}`);
      matches.push(currentMatch);
    }

    socket.join(currentMatch.id);
    const team = currentMatch.addPlayer(socket.id, data.avatarRebirths || 0, data.totalWins || 0);
    if (team) {
      socket.emit('team', team);
      
      // Send complete player data to the new player
      socket.emit('init', currentMatch.players);
      
      // Notify all other players in the match about the new player
      socket.to(currentMatch.id).emit('update', { 
        id: socket.id, 
        ...currentMatch.players[socket.id] 
      });
      
      // Broadcast updated player list to everyone
      currentMatch.broadcastPlayers();
      
      if (currentMatch.state === 'explore') {
        socket.emit('exploreMode', { layout: currentMatch.layout });
      }
      console.log(`Player ${socket.id} joined match ${currentMatch.id} in state ${currentMatch.state}`);
    }
  });

  socket.on('update', (data) => {
    const match = matches.find(m => m.players[socket.id]);
    if (match && (match.state === 'active' || match.state === 'explore')) {
      match.updatePlayer(socket.id, data);
    }
  });

  socket.on('shoot', (data) => {
    const match = matches.find(m => m.players[socket.id]);
    if (!match) {
      console.log(`Player ${socket.id} tried to shoot but is not in a match`);
      return;
    }
    
    if (match.state !== 'active') {
      console.log(`Player ${socket.id} tried to shoot but match is not active (state: ${match.state})`);
      return;
    }
    
    if (!data.target) {
      console.log(`Player ${socket.id} sent invalid shoot data: missing target`);
      return;
    }
    
    if (!match.players[data.target]) {
      console.log(`Player ${socket.id} tried to shoot non-existent player ${data.target}`);
      return;
    }
    
    const shooter = match.players[socket.id];
    const target = match.players[data.target];
    
    // Additional debug information to track team issues
    console.log(`SHOOT EVENT: ${socket.id} (${shooter.team}) → ${data.target} (${target.team})`);
    console.log(`Teams - Shooter: ${shooter.team}, Target: ${target.team}, Data Team: ${data.shooterTeam}`);
    
    // Make sure team info is consistent
    if (shooter.team !== data.shooterTeam) {
      console.log(`Team mismatch! Server thinks ${socket.id} is on team ${shooter.team} but client reports ${data.shooterTeam}`);
      // Sync back the correct team to the client
      io.to(socket.id).emit('teamSync', { team: shooter.team });
    }
    
    // Check for team killing - compare server-side teams, not client-reported team
    if (shooter.team === target.team) {
      console.log(`Player ${socket.id} (${shooter.team}) tried to shoot teammate ${data.target} (${target.team})`);
      return;
    }
    
    // Apply damage
    target.health = Math.max(0, target.health - data.amount);
    
    // Notify the target player they've been hit
    io.to(data.target).emit('damage', { 
      target: data.target, 
      amount: data.amount,
      position: data.position,
      shooterId: socket.id
    });
    
    // Notify all players in the match about the hit
    io.to(match.id).emit('hit', { 
      shooter: socket.id,
      target: data.target,
      position: data.position
    });
    
    console.log(`Player ${socket.id} (${shooter.team}) hit player ${data.target} (${target.team}) for ${data.amount} damage. Target health: ${target.health}`);

    // Check for kill
    if (target.health <= 0) {
      console.log(`Player ${socket.id} killed player ${data.target}`);
      match.endRound(socket.id, data.target);
      target.health = 100;
      target.x = target.team === 'green' ? -14 : 14;
      target.z = target.team === 'green' ? -14 : 14;
      io.to(match.id).emit('update', { id: data.target, ...target });
    }
    
    // Broadcast updated player state to ensure health is synced
    match.broadcastPlayers();
  });

  // Add a new handler for team synchronization
  socket.on('requestTeamSync', () => {
    const match = matches.find(m => m.players[socket.id]);
    if (match && match.players[socket.id]) {
      const team = match.players[socket.id].team;
      socket.emit('teamSync', { team });
      console.log(`Team sync requested by ${socket.id}, sent: ${team}`);
    }
  });

  socket.on('disconnect', () => {
    const match = matches.find(m => m.players[socket.id]);
    if (match) {
      match.removePlayer(socket.id);
    }
    console.log('Player disconnected:', socket.id);
  });

  socket.on('enterFreePlay', () => {
    const match = matches.find(m => m.players[socket.id]);
    if (match && match.state === 'waiting') {
      clearInterval(match.waitTimer);
      match.state = 'explore';
      io.to(match.id).emit('exploreMode', { layout: match.layout });
      console.log(`Player ${socket.id} chose free play in match ${match.id}`);
    }
  });

  socket.on('updateHead', (data) => {
    const match = matches.find(m => m.players[socket.id]);
    if (match) {
      match.updateHead(socket.id, data.meshUrl);
    } else {
      console.log(`No match found for ${socket.id}, queuing head update`);
      const pendingMatch = matches.find(m => m.state === 'waiting' && Object.keys(m.players).length < 2);
      if (pendingMatch) pendingMatch.updateHead(socket.id, data.meshUrl);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});