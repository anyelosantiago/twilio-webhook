# Twilio Webhook Server & Google Account Automation

This repository contains two main components:

## 1. Twilio SMS Webhook Server (Node.js)

A Node.js/Express server that receives SMS messages via Twilio webhooks, extracts verification codes, and provides API endpoints to retrieve them.

### Features
- Receives SMS messages through Twilio webhooks
- Extracts verification codes from SMS text using intelligent regex patterns
- Stores messages by phone number (last 5 messages per number)
- Global message bank for all incoming SMS
- RESTful API endpoints for code retrieval
- Automatic message cleanup (TTL: 10 minutes)

### Setup
```bash
npm install
npm start
```

### API Endpoints
- `POST /sms-webhook` - Twilio webhook endpoint
- `GET /get-code/:from` - Get latest verification code from specific number
- `GET /get-last/:from` - Get last message from specific number
- `POST /consume-code` - Consume (remove) latest code from specific number
- `GET /inbox` - Global message inbox with filtering options
- `GET /inbox/latest-code` - Get latest verification code from any number
- `POST /test-extract` - Test code extraction functionality

## 2. Google Account Automation (Python)

A Python script that automates Google account creation using Selenium WebDriver and AdsPower browser profiles.

### Features
- Integrates with AdsPower browser profiles for antidetect browsing
- Automates Google account signup process
- Handles form filling with error recovery
- Provides detailed logging of each step
- Manual fallback for failed actions

### Requirements
```bash
pip install -r requirements.txt
```

### Setup
1. Install Python dependencies: `pip install -r requirements.txt`
2. Configure AdsPower profile ID in the script
3. Ensure AdsPower is running on default port (50325)

### Usage
```bash
python google_account_automation.py
```

### Configuration
- Update `ADSPOWER_PROFILE_ID` in the script to match your AdsPower profile
- Modify name and surname values as needed
- AdsPower must be running locally on port 50325

## Project Structure
```
├── server.js                      # Twilio webhook server (Node.js)
├── package.json                   # Node.js dependencies
├── google_account_automation.py   # Google automation script (Python)
├── requirements.txt               # Python dependencies
└── README.md                      # This file
```

## Environment Variables
- `TWILIO_AUTH_TOKEN` - Optional: Enables Twilio signature verification
- `PORT` - Server port (default: 3000)

## License
MIT License