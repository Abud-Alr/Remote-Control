# 🏎️ Remote Stunt Car Controller

A real-time multiplayer stunt car game where players use their phones as wireless controllers to drive 3D cars on a shared screen. Built with **Three.js**, **Cannon-es** physics, and **Socket.IO** for seamless WebSocket communication.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [How to Play](#how-to-play)
- [License](#license)

---

## Overview

Remote Stunt Car Controller transforms any device with a browser into a game controller. One device (desktop, laptop, or TV) runs the **Game Screen** displaying a full 3D stunt track, while up to **4 players** connect from their phones to steer, boost, jump, and perform flips — all in real-time over a local network.

---

## ✨ Features

- **Multiplayer** — Up to 4 simultaneous players, each assigned a unique color identity.
- **Phone-as-Controller** — Virtual joystick and action buttons optimized for mobile touch input.
- **3D Stunt Track** — Fully rendered 3D environment with physics-driven car mechanics.
- **Real-Time Physics** — Powered by Cannon-es for realistic collisions, jumps, and gravity.
- **Live HUD** — Leaderboard, speed gauge, and countdown timer on the game screen.
- **Instant Connection** — No app install required; players join via a URL on the local network.
- **Auto Role Detection** — Mobile devices are automatically prompted to open the controller.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Node.js Server                       │
│              (Express + Socket.IO)                      │
│                                                         │
│   ┌─────────────┐     ┌──────────────────────────────┐  │
│   │   Player     │◄───►│    Event Relay & State Mgmt  │  │
│   │  Management  │     │  (move, boost, jump, flip)   │  │
│   └─────────────┘     └──────────────────────────────┘  │
└────────────┬────────────────────────┬───────────────────┘
             │  WebSocket             │  WebSocket
             ▼                        ▼
  ┌─────────────────┐     ┌────────────────────────┐
  │  📱 Controller   │     │  🖥️ Game Screen         │
  │  (Phone Browser) │     │  (Desktop / TV Browser) │
  │                   │     │                          │
  │  • Virtual Stick  │     │  • Three.js 3D Renderer  │
  │  • Boost / Jump   │     │  • Cannon-es Physics     │
  │  • Flip Button    │     │  • HUD & Leaderboard     │
  └───────────────────┘     └──────────────────────────┘
```

---

## 🛠️ Tech Stack

| Layer         | Technology                                                                      |
|---------------|---------------------------------------------------------------------------------|
| **Server**    | [Node.js](https://nodejs.org/) + [Express](https://expressjs.com/)              |
| **Real-Time** | [Socket.IO](https://socket.io/) (WebSocket with fallback)                       |
| **3D Engine** | [Three.js](https://threejs.org/) v0.160 (ES Module via CDN)                     |
| **Physics**   | [Cannon-es](https://pmndrs.github.io/cannon-es/) v0.20 (rigid-body dynamics)   |
| **Frontend**  | Vanilla HTML, CSS, JavaScript                                                   |

---

## 📁 Project Structure

```
Remote-Control/
├── server.js                  # Express + Socket.IO server (player management, event relay)
├── public/
│   ├── index.html             # Landing page — role selection (Game Screen vs. Controller)
│   ├── game.html              # Game screen — 3D canvas, HUD, and waiting overlay
│   ├── controller.html        # Mobile controller — joystick, boost, jump, and flip
│   ├── css/
│   │   ├── common.css         # Shared design tokens and base styles
│   │   ├── landing.css        # Landing page styles
│   │   ├── game.css           # Game screen and HUD styles
│   │   └── controller.css     # Mobile controller layout and touch UI
│   └── js/
│       ├── game.js            # Three.js scene, Cannon-es physics, car rendering
│       ├── controller.js      # Joystick logic, touch handlers, action buttons
│       └── socket-events.js   # Shared Socket.IO connection and event helpers
├── package.json
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v16 or later

### Installation

```bash
# Clone the repository
git clone https://github.com/Abud-Alr/Remote-Control.git
cd Remote-Control

# Install dependencies
npm install

# Start the server
npm start
```

The server will start on **http://localhost:3000** by default.

### Connecting from Other Devices

Ensure all devices are on the **same local network** (Wi-Fi). The landing page displays the server URL — share it with players or have them navigate to your machine's local IP address, e.g.:

```
http://192.168.x.x:3000
```

---

## 🎮 How to Play

1. **Open the Game Screen** — On a desktop or TV, navigate to the server URL and select **Game Screen**.
2. **Connect Controllers** — On each player's phone, navigate to the same URL and select **Controller**.
3. **Drive!** — Use the virtual joystick to steer and accelerate. Tap **Boost** for a speed burst, **Jump** to launch into the air, and **Flip** to perform aerial tricks.
4. **Compete** — Score points and race against the clock. The leaderboard updates in real-time.

---

## 📄 License

This project is open-source. Feel free to modify and distribute as needed.