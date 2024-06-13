const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const app = express();

// Enable CORS for all routes
app.use(cors(), express.json());

// Create an HTTP server
const server = http.createServer(app);

// Set up Socket.IO with CORS configuration
const io = new Server(server, {
  cors: {
    origin: "*", // Replace with specific origin in production
    methods: ["GET", "POST"],
  },
});

let usernames = {};

app.post("/register-username", (req, res) => {
  let username = req.body.username;
  if (usernames[username]) {
    res.status(200).send(JSON.stringify("This username is already in use!"));
  } else {
    usernames[username] = "";
    setTimeout(() => {
      if (usernames[username] == "") {
        delete usernames[username];
      }
    }, 5000);
    res.status(200).send(JSON.stringify("Username available"));
  }
});

// Lobby games
let lobbyGames = {};
let lobbyGamesPasswords = {};
// Games
let gamesInProgress = {};
const pieceValue = {
  small: 1,
  medium: 2,
  large: 3,
  "": 0,
};
io.on("connection", (socket) => {
  // Handiling connection
  const enDate = new Date();
  console.log(
    `User connected: ${
      socket.id
    } | ${enDate.getHours()}:${enDate.getMinutes()} ${enDate.getDate()}/${enDate.getMonth()}`
  );
  socket.join("lobby");
  socket["playerState"] = {
    inGame: false,
    gameID: null,
    opponent: null,
  };
  socket.emit("updateGames", lobbyGames);

  // Joining games
  socket.on("joinGame", (game) => {
    const socketB = usernames[game.creatorName];
    // Check if game still available
    if (!socketB) {
      socket.emit("playerIsUnavailable");
      return;
    }
    // Need to check password if this game have
    if (game.password) {
      if (game.userPassword) {
        if (lobbyGamesPasswords[game.gameID] != game.userPassword) {
          socket.emit("wrongPassword");
          return;
        }
      } else {
        socket.emit("wrongPassword");
        return;
      }
    }
    // Join players in one room
    socket.leave("lobby");
    socketB.leave("lobby");
    socketB.join(game.gameID);
    socket.join(game.gameID);
    // Create a game
    const random = Math.floor(Math.random() * 2);
    const BluePlayer = random == 1 ? socketB["username"] : socket["username"];
    gameStructure = {
      gameID: game.gameID,
      playerBlue: {
        name: BluePlayer,
        pieces: { small: 2, medium: 2, large: 2 },
      },
      playerRed: {
        name: random != 1 ? socketB["username"] : socket["username"],
        pieces: { small: 2, medium: 2, large: 2 },
      },
      board: Array(9).fill({ size: "", player: 0 }),
      gameState: { status: "playing", winner: null, playerToPlay: BluePlayer },
      movesMade: [],
      chat: [],
      winnerSquares: [],
    };
    gamesInProgress[game.gameID] = gameStructure;
    // socket["playerState"] = {
    //   inGame: true,
    //   gameID: game.gameID,
    //   opponent: socketB["username"],
    // };
    socket.emit("enterGame", gameStructure);
    socketB.emit("enterGame", gameStructure);

    delete lobbyGamesPasswords[game.gameID];
    delete lobbyGames[game.creatorName];
    socket.to("lobby").emit("updateGames", lobbyGames);
  });

  socket.on("goBackToLobby", () => {
    const setOfRooms = socket.rooms;
    const room = [...setOfRooms][1];
    socket.to(room).emit("newMessage", {
      name: "SYSTEM",
      message: "Your opponent left the chat.",
    });
    socket.leave(room);
    socket.join("lobby");
    socket.emit("clearToGoLobby", lobbyGames);
  });
  socket.on("acceptChallenge", async (game) => {
    const sockets = await numberOfSocketInRoom(game.gameID);
    if (sockets.length < 2) {
      socket.emit("opponentAbandonedChallenge");
      return;
    }
    const random = Math.floor(Math.random() * 2);
    const BluePlayer = random == 1 ? game.playerBlue.name : game.playerRed.name;
    gameStructure = {
      gameID: game.gameID,
      playerBlue: {
        name: BluePlayer,
        pieces: { small: 2, medium: 2, large: 2 },
      },
      playerRed: {
        name: random != 1 ? game.playerBlue.name : game.playerRed.name,
        pieces: { small: 2, medium: 2, large: 2 },
      },
      board: Array(9).fill({ size: "", player: 0 }),
      gameState: { status: "playing", winner: null, playerToPlay: BluePlayer },
      movesMade: [],
      chat: game.chat,
      winnerSquares: [],
    };
    gamesInProgress[game.gameID] = gameStructure;
    socket.to(game.gameID).emit("acceptedChallenge", gameStructure);
    socket.emit("newGameChallenge", gameStructure);
  });
  socket.on("declineChallenge", (gameID) => {
    socket.to(gameID).emit("declinedChallenge");
  });

  socket.on("checkChallengedOpponent", async (gameID) => {
    const sockets = await numberOfSocketInRoom(gameID);
    if (sockets.length < 2) {
      socket.emit("declinedChallenge");
    }
  });
  socket.on("challengeAgain", (gameID) => {
    socket.to(gameID).emit("challengedAgain");
  });
  socket.on("acceptDraw", (gameID) => {
    socket.to(gameID).emit("acceptedDraw");
    delete gamesInProgress[gameID];
  });
  socket.on("declineDraw", (gameID) => {
    socket.to(gameID).emit("declinedDraw");
  });
  socket.on("offerDraw", (gameID) => {
    socket.to(gameID).emit("offeringADraw");
  });
  socket.on("quitGame", (gameID) => {
    socket.to(gameID).emit("opponentLeftTheGame");
    delete gamesInProgress[gameID];
  });

  // Checking is opponent still connected
  socket.on("isOpponentAlive", async (gameID) => {
    const game = gamesInProgress[gameID];
    if (!game) return;
    // Getting the username of the socket
    const username = socket["username"];
    // Getting the opponent socket
    const opponentSocket =
      game.playerBlue.name == username
        ? usernames[game.playerRed.name]
        : usernames[game.playerBlue.name];
    if (opponentSocket) {
      const connected = isSocketConnected(opponentSocket.id);
      if (connected) {
        return;
      }
    }
    delete gamesInProgress[gameID];
    socket.emit("opponentLostConnection", lobbyGames);
  });

  // Playing game
  socket.on("playerMadeAMove", (move) => {
    game = gamesInProgress[move.gameID];
    if (!game) {
      return;
    }
    if (!usernames[move.playerUsername]) {
      return;
    }
    // Validating that the requester is indeed the player of the game
    if (usernames[move.playerUsername].id != socket.id) {
      console.log(
        `${socket.id} | ${socket.handshake.address} maybe was able to cheat ?`
      );
      return;
    }
    if (game.gameState.playerToPlay != move.playerUsername) {
      `${socket.id} | ${socket.handshake.address} send a request while its not he's turn ?`;
      return;
    }
    let playerMadeTheMove =
      game.playerBlue.name == move.playerUsername ? "playerBlue" : "playerRed";
    let playerB =
      playerMadeTheMove == "playerBlue" ? "playerRed" : "playerBlue";
    // Checking if he has the available pieces
    if (game[playerMadeTheMove].pieces[move.size] - 1 < 0) {
      console.log(
        `${socket.id} | ${socket.handshake.address} was able to send request to put a piece he doesn't have!`
      );
      return;
    }
    // Checking if the piece on the board is equal or smaller than the piece he trying to put
    if (pieceValue[game.board[move.squareId].size] >= pieceValue[move.size]) {
      console.log(
        `${socket.id} | ${socket.handshake.address} was able to send request to put a piece smaller/equal to piece already on the board!`
      );
      return;
    }
    // Removing the piece
    game[playerMadeTheMove].pieces[move.size] -= 1;
    // Applying the move to the board
    game.board[move.squareId] = {
      size: move.size,
      player: game.playerBlue.name == move.playerUsername ? "blue" : "red",
    };
    const [result, winnerSquares] = checkWinner(game.board);

    if (result != 0) {
      game.gameState.winner = result;
      game.winnerSquares = winnerSquares;
      // Sending to the winner the winner squares
      socket.emit("opponentMadeAMove", game);
      delete gamesInProgress[game.gameID];
    } else {
      // Switching turns
      game.gameState.playerToPlay = game[playerB].name;
      // Saving changes
      gamesInProgress[game.gameID] = game;
    }
    // Emitting the new move to the opponent

    socket.to(game.gameID).emit("opponentMadeAMove", game);
  });

  socket.on("message", (message) => {
    if (!message.gameID || !message.username) return;
    gamesInProgress[message.gameID].chat.push({
      message: message.message,
      name: message.username,
    });
    socket
      .to(message.gameID)
      .emit("newMessage", { message: message.message, name: message.username });
  });

  // Creating a new game
  socket.on("createNewGame", (data) => {
    if (!usernames[data.creatorName]) {
      usernames[data.creatorName];
      socket["username"] = data.creatorName;
    }
    // Random game id
    let gameId = Math.floor(Math.random() * 10000000000);
    // Addding the game into lobby games
    lobbyGames[data.creatorName] = {
      gameID: gameId,
      password: data.password.length > 0 ? true : false,
    };
    // If password is not empty then this game require thus saving it to the lobbygamespasswords to verify when another client try to connect if he entered the right password
    if (data.password.length > 0) lobbyGamesPasswords[gameId] = data.password;

    // Emitting the new game to all players found in the lobby
    socket.to("lobby").emit("updateGames", lobbyGames);
  });

  // Deleting games
  socket.on("deleteCreatedGame", (username) => {
    if (lobbyGames[username]) {
      // Deleting the game that the user created
      delete lobbyGamesPasswords[lobbyGames[username]["gameID"]];
      delete lobbyGames[username];
      socket.to("lobby").emit("updateGames", lobbyGames);
    }
  });

  // Adding/Deleting username
  socket.on("saveUsername", (username) => {
    usernames[username] = socket;
    socket["username"] = username;
  });

  socket.on("deleteUsername", (username) => {
    if (lobbyGames[username]) {
      delete lobbyGamesPasswords[lobbyGames[username]["gameID"]];
      delete lobbyGames[username];
      socket.to("lobby").emit("updateGames", lobbyGames);
    }
    delete usernames[username];
    delete socket["username"];
  });

  // Handiling disconnection
  socket.on("disconnect", () => {
    console.log(
      "User disconnected:",
      socket.id,
      `${enDate.getHours()}:${enDate.getMinutes()} ${enDate.getDate()}/${enDate.getMonth()}`
    );
    let username = socket["username"];
    // Checking if this user created any games
    if (lobbyGames[username]) {
      // Deleting the game that the user created
      delete lobbyGamesPasswords[lobbyGames[username]["gameID"]];
      delete lobbyGames[username];
      socket.to("lobby").emit("updateGames", lobbyGames);
    }
    delete usernames[username];
  });
});

function checkWinner(board) {
  let result = 0;
  let winnerSquares = null;

  // Check horizontal
  for (let i = 0; i < 3; i++) {
    const index = i * 3;
    if (
      board[index].player &&
      board[index].player === board[index + 1].player &&
      board[index].player === board[index + 2].player
    ) {
      result = board[index].player;
      winnerSquares = [index, index + 1, index + 2];
      return [result, winnerSquares];
    }
  }

  // Check vertical
  for (let i = 0; i < 3; i++) {
    if (
      board[i].player &&
      board[i].player === board[i + 3].player &&
      board[i].player === board[i + 6].player
    ) {
      result = board[i].player;
      winnerSquares = [i, i + 3, i + 6];
      return [result, winnerSquares];
    }
  }

  // Check diagonal
  if (
    board[0].player &&
    board[0].player === board[4].player &&
    board[0].player === board[8].player
  ) {
    result = board[0].player;
    winnerSquares = [0, 4, 8];
    return [result, winnerSquares];
  }

  if (
    board[2].player &&
    board[2].player === board[4].player &&
    board[2].player === board[6].player
  ) {
    result = board[2].player;
    winnerSquares = [2, 4, 6];
    return [result, winnerSquares];
  }

  // Returns
  return [result, winnerSquares];
}

function isSocketConnected(socketId) {
  return io.sockets.sockets.has(socketId);
}

async function numberOfSocketInRoom(roomID) {
  return (sockets = await io.in(roomID).fetchSockets());
}
// Start the server
const PORT = process.env["PORT"] || 3000;
server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
