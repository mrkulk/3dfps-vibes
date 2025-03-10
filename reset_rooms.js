/**
 * Reset Rooms Script
 * 
 * This script connects to the game server and resets all active matches.
 * It can be run independently to clear any stuck or bugged game state.
 */

const { io } = require('socket.io-client');
const readline = require('readline');

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Server URL - change this to match your server's URL
const SERVER_URL = 'https://game.csm.ai';

// Function to reset all rooms
async function resetAllRooms() {
  console.log(`Connecting to server at ${SERVER_URL}...`);
  
  // Connect to the server as an admin client
  const socket = io(SERVER_URL, {
    query: {
      isAdmin: true,
      adminKey: 'admin-reset-key' // This should match a key you set on the server
    }
  });

  // Handle connection events
  socket.on('connect', () => {
    console.log('Connected to server successfully.');
    console.log('Sending reset command...');
    
    // Send reset command to server
    socket.emit('adminResetRooms');
  });

  // Handle admin response
  socket.on('adminResetResponse', (data) => {
    console.log(`Reset response: ${data.message}`);
    console.log(`Rooms reset: ${data.roomsReset}`);
    
    // Disconnect after receiving response
    socket.disconnect();
    rl.close();
  });

  // Handle connection errors
  socket.on('connect_error', (error) => {
    console.error('Connection error:', error.message);
    console.log('Make sure the server is running and the admin key is correct.');
    socket.disconnect();
    rl.close();
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Disconnected from server.');
  });
}

// Ask for confirmation before resetting
rl.question('Are you sure you want to reset all game rooms? This will disconnect all players. (y/n): ', (answer) => {
  if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
    resetAllRooms();
  } else {
    console.log('Reset cancelled.');
    rl.close();
  }
}); 