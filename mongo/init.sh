#!/bin/bash

echo "🛠️  Preparing MongoDB keyfile..."

# Copy the keyfile into a safe place and fix permissions
cp /etc/mongo-keyfile /data/keyfile
chmod 400 /data/keyfile
chown mongodb:mongodb /data/keyfile

echo "🚀 Starting MongoDB..."

# Start MongoDB with your custom config and the correctly permissioned keyfile
exec mongod --config /etc/mongod.conf --keyFile /data/keyfile
