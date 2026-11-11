@echo off
if not exist .env copy .env.example .env
node server.js
pause
