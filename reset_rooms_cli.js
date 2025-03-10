/**
 * Reset Rooms CLI Script
 * 
 * A simple command-line script to reset all game rooms using the HTTP API.
 * This is an alternative to the Socket.IO-based reset_rooms.js script.
 */

const https = require('https');
const readline = require('readline');

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Server URL - change this to match your server's URL
const SERVER_HOST = 'game.csm.ai';
const SERVER_PATH = '/admin/reset-rooms';
const ADMIN_KEY = 'admin-reset-key'; // This should match the key in server.js

// Function to reset all rooms via HTTP API
function resetAllRooms() {
  console.log(`Connecting to server at ${SERVER_HOST}...`);
  
  const options = {
    hostname: SERVER_HOST,
    port: 443, // HTTPS port
    path: SERVER_PATH,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ADMIN_KEY}`,
      'Content-Type': 'application/json'
    }
  };
  
  const req = https.request(options, (res) => {
    console.log(`Status: ${res.statusCode}`);
    
    let data = '';
    
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      try {
        const response = JSON.parse(data);
        console.log('Response:', response);
        
        if (response.success) {
          console.log(`Reset successful. ${response.roomsReset} rooms were reset.`);
        } else {
          console.log('Reset failed:', response.message);
        }
      } catch (e) {
        console.error('Error parsing response:', e.message);
        console.log('Raw response:', data);
      }
      
      rl.close();
    });
  });
  
  req.on('error', (error) => {
    console.error('Error:', error.message);
    console.log('Make sure the server is running and accessible.');
    rl.close();
  });
  
  req.end();
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