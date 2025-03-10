#!/bin/bash

# Reset Rooms Shell Script
# A simple shell script to reset all game rooms

echo "Game Room Reset Utility"
echo "======================="
echo ""
echo "This script will reset all active game rooms and disconnect all players."
echo ""

read -p "Are you sure you want to reset all game rooms? (y/n): " confirm

if [[ $confirm == [yY] || $confirm == [yY][eE][sS] ]]; then
  echo "Resetting all rooms..."
  
  # Use curl to make the HTTP request
  response=$(curl -s -X POST \
    -H "Authorization: Bearer admin-reset-key" \
    -H "Content-Type: application/json" \
    https://game.csm.ai/admin/reset-rooms)
  
  # Check if curl command was successful
  if [ $? -eq 0 ]; then
    echo "Response received:"
    echo $response | jq . 2>/dev/null || echo $response
    echo ""
    echo "Reset complete!"
  else
    echo "Error: Failed to connect to the server."
    echo "Make sure the server is running and accessible."
  fi
else
  echo "Reset cancelled."
fi

echo ""
echo "Press Enter to exit..."
read 