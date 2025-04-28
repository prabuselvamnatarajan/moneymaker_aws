#!/bin/bash

# Configuration for the replica set
config = {
  "_id": "rs0",
  "members": [
    { "_id": 0, "host": "mongo1:27017" },
    { "_id": 1, "host": "mongo2:27017" },
    { "_id": 2, "host": "mongo3:27017" }
  ]
};

# Initiate the replica set
rs.initiate(config);

# Optional: Check status after a short delay
sleep(5000); // Wait 5 seconds
printjson(rs.status());