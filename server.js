const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});

// Хранилище для всех подключенных игроков
const players = {};

// Привязываем статические файлы (клиентскую часть)
app.use(express.static(__dirname + '/public'));

io.on('connection', (socket) => {
    console.log(`Игрок подключился: ${socket.id}`);

    // Создаем нового игрока со случайными координатами и цветом
    players[socket.id] = {
        x: Math.floor(Math.random() * 700) + 50,
        y: Math.floor(Math.random() * 500) + 50,
        color: `#${Math.floor(Math.random()*16777215).toString(16)}`
    };

    // Отправляем новому игроку список всех текущих игроков
    socket.emit('currentPlayers', players);
    // Сообщаем остальным, что подключился новый игрок
    socket.broadcast.emit('newPlayer', { id: socket.id, info: players[socket.id] });

    // Обработка движения игрока
    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            // Рассылаем новые координаты всем остальным
            socket.broadcast.emit('playerMoved', { id: socket.id, x: players[socket.id].x, y: players[socket.id].y });
        }
    });

    // Обработка отключения игрока
    socket.on('disconnect', () => {
        console.log(`Игрок отключился: ${socket.id}`);
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => { // Добавили '0.0.0.0', чтобы Render видел подключения
    console.log(`Сервер запущен на порту ${PORT}`);
});
