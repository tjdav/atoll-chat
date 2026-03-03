# Coralite Chat

A real-time chat application built with [Coralite](https://coralite.dev/) and [PocketBase](https://pocketbase.io/). This project demonstrates how to build a reactive, component-based web application with a real-time backend.

## Features

* **Real-Time Messaging**: Messages appear instantly across all connected clients via PocketBase's real-time subscriptions.
* **User Authentication**: Secure email/password login with optional "Remember me" session handling.
* **File Attachments**: Support for sending text messages alongside file attachments.
* **Component-Based Architecture**: Built using Coralite templates (`login-form`, `chat-window`).
* **Responsive UI**: Styled with Bootstrap 5 and SCSS for a clean, mobile-friendly interface.

## Tech stack

* **Frontend**: [Coralite](https://coralite.dev/) (Web Components & Templates), JavaScript (ES2022), HTML5, SCSS.
* **UI Framework**: [Bootstrap 5.3](https://getbootstrap.com/)
* **Backend**: [PocketBase](https://pocketbase.io/) (Authentication & Real-time Database)

## Getting started

### Prerequisites

* Node.js (v18+ recommended)
* A running instance of [PocketBase](https://pocketbase.io/docs/) (Local or Hosted)

### 1. PocketBase Setup

Before running the frontend, you need to configure your PocketBase backend.

1. **Auto-Download PocketBase (Optional):** Run the following script to automatically download the latest PocketBase binary matching your OS & Architecture:
```bash
npm run db:download
```
2. Start PocketBase locally: `./database/pocketbase serve` (It will run on `http://127.0.0.1:8090` by default, which matches the project configuration).
3. **Initial DB Setup:** In a new terminal, while PocketBase is running, execute the following script to create an admin user and set up the default database collections automatically:
```bash
npm run db:setup
```
4. Go to the Admin UI (`http://127.0.0.1:8090/_/`).
5. **Configure Collections:**
* **`users`** (Default collection): Make sure email/password authentication is enabled.
* **`messages`** (New collection): Create a new collection named `messages` with the following schema:
* `text` (Type: Plain text)
* `user` (Type: Relation -> pointing to `users` collection)
* `attachment` (Type: File - *optional*)

4. **API Rules:** Make sure to unlock the API rules for the `messages` collection so authenticated users can `create` and `read` messages.

### Frontend setup

1. Clone the repository and navigate to the project folder:
```bash
cd coralite-chat

```

2. Install the dependencies using npm:
```bash
npm install

```

3. Start the development server:
```bash
npm start

```

*This uses `coralite-scripts dev` with the required experimental VM modules enabled.*
4. Open your browser and navigate to the local server address provided in the terminal.

## Project structure

* `src/pages/` - Contains the main HTML entry points (`index.html` for login, `chat.html` for the chat interface).
* `src/templates/` - Coralite components containing the scoped logic and UI (`login-form.html`, `chat-window.html`).
* `src/plugins/` - Contains the PocketBase initialization, session handling, and helper methods (`pockbase.js`).
* `src/scss/` - SCSS stylesheets and Bootstrap imports.
* `public/` - Static assets like images and favicons.
* `coralite.config.js` - Configuration file for the Coralite build system.

## Available scripts

* `npm start`: Starts the local development server.
* `npm build`: Builds the project for production, outputting static files to the `dist` directory.
