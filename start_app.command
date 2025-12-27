#!/bin/bash

# Launch backend
cd "$(dirname "$0")/backend" || exit 1
npm start >/tmp/postfilter-backend.log 2>&1 &
BACK_PID=$!

# Launch frontend
cd ../frontend || exit 1
npm run dev >/tmp/postfilter-frontend.log 2>&1 &
FRONT_PID=$!

echo "Backend PID: $BACK_PID (log: /tmp/postfilter-backend.log)"
echo "Frontend PID: $FRONT_PID (log: /tmp/postfilter-frontend.log)"
echo "Frontend: http://localhost:5173"
