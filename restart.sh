#!/bin/bash

# PAM Monitor Restart Script
# Kills servers on ports 31190 and 31191 (non-Docker), restarts them, and opens the frontend

FRONTEND_PORT=31190
BACKEND_PORT=31191
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Stopping existing servers...${NC}"

# Function to kill process on a port (excluding Docker)
kill_port() {
    local port=$1
    local pid=$(lsof -ti :$port 2>/dev/null)

    if [ -n "$pid" ]; then
        # Check if it's NOT a Docker process
        if ! ps -p $pid -o command= | grep -q "docker"; then
            echo -e "${GREEN}Killing process $pid on port $port${NC}"
            kill $pid 2>/dev/null
            sleep 1
            # Force kill if still running
            if ps -p $pid > /dev/null 2>&1; then
                kill -9 $pid 2>/dev/null
            fi
        else
            echo -e "${YELLOW}Skipping Docker process on port $port${NC}"
        fi
    else
        echo -e "${YELLOW}No process found on port $port${NC}"
    fi
}

kill_port $FRONTEND_PORT
kill_port $BACKEND_PORT

echo -e "${YELLOW}Waiting for ports to be released...${NC}"
sleep 2

echo -e "${GREEN}Starting backend...${NC}"
cd "$SCRIPT_DIR/backend"
npm run dev > /tmp/pam-monitor-backend.log 2>&1 &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID"

# Wait for backend to be ready
echo -e "${YELLOW}Waiting for backend to start...${NC}"
for i in {1..30}; do
    if curl -s http://localhost:$BACKEND_PORT/health > /dev/null 2>&1; then
        echo -e "${GREEN}Backend is ready!${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}Backend failed to start. Check /tmp/pam-monitor-backend.log${NC}"
        exit 1
    fi
    sleep 1
done

echo -e "${GREEN}Starting frontend...${NC}"
cd "$SCRIPT_DIR/frontend"
npm run dev > /tmp/pam-monitor-frontend.log 2>&1 &
FRONTEND_PID=$!
echo "Frontend PID: $FRONTEND_PID"

# Wait for frontend to be ready
echo -e "${YELLOW}Waiting for frontend to start...${NC}"
for i in {1..30}; do
    if curl -s http://localhost:$FRONTEND_PORT > /dev/null 2>&1; then
        echo -e "${GREEN}Frontend is ready!${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}Frontend failed to start. Check /tmp/pam-monitor-frontend.log${NC}"
        exit 1
    fi
    sleep 1
done

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}PAM Monitor is running!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "Frontend: ${YELLOW}http://localhost:$FRONTEND_PORT${NC}"
echo -e "Backend:  ${YELLOW}http://localhost:$BACKEND_PORT${NC}"
echo ""
echo -e "Backend log: ${YELLOW}/tmp/pam-monitor-backend.log${NC}"
echo -e "Frontend log: ${YELLOW}/tmp/pam-monitor-frontend.log${NC}"
echo ""

# Open in browser
if command -v open > /dev/null; then
    # macOS
    open http://localhost:$FRONTEND_PORT
elif command -v xdg-open > /dev/null; then
    # Linux
    xdg-open http://localhost:$FRONTEND_PORT
elif command -v start > /dev/null; then
    # Windows
    start http://localhost:$FRONTEND_PORT
fi

echo -e "${YELLOW}Press Ctrl+C to stop all servers...${NC}"

# Handle Ctrl+C to clean up
cleanup() {
    echo ""
    echo -e "${YELLOW}Stopping servers...${NC}"
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    wait $BACKEND_PID 2>/dev/null
    wait $FRONTEND_PID 2>/dev/null
    echo -e "${GREEN}Done!${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM

# Keep script running
wait
