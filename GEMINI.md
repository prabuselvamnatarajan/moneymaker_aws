after every changes the AI need to update the git with proper message for the changes. so i will have a all the changes tracked.

# Development System Config
- Operating System: win32
- the default terminal is powershell

# Tech Stack
This project is a collection of microservices primarily built with Node.js. It uses Kafka for messaging, MongoDB as a database, and Redis for caching. The services are containerized using Docker.

## Key Technologies used:
- **Backend:** Node.js, Express.js
- **Database:** MongoDB
- **Messaging:** Kafka
- **Caching:** Redis
- **Containerization:** Docker
- **API Communication:** REST, WebSockets, gRPC (protobuf)
- **Other Libraries:**
    - `axios` for making HTTP requests
    - `ws` for WebSocket communication
    - `kafkajs` for interacting with Kafka
    - `mongodb` for interacting with MongoDB
    - `protobufjs` for working with Protocol Buffers
    - `dotenv` for managing environment variables
    - `luxon` and `node-cron` for scheduling tasks
# rules:
    - need to update the memory with the gemini.md file once it is modified. so keep track of gemini.md file