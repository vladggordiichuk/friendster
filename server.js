"use strict";

const express = require('express');
const app = express();
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const mysql = require('./mysql');
const server = require('http').Server(app);
const io = require('socket.io')(server);


app.use(expressLayouts);
app.use(express.static(__dirname));
app.set('view engine', 'ejs');
app.use(express.json({limit: '50mb'}));
app.use(express.urlencoded({limit: '50mb'}));
app.use(session({secret: 'secret', resave: false, saveUninitialized: false}));

const PORT = process.env.PORT || 7777;
server.listen(PORT, () => {
    console.log('Starting on port ' + PORT);
});


app.get('/', async (req, res) => {
    if (!req.session.user) res.render('login');
    else {
        let roomChats = await mysql('SELECT * FROM messages INNER JOIN rooms ON messages.toRoomId=rooms.id WHERE messages.id IN (SELECT MAX(id) FROM messages WHERE messages.toUserId=-1 AND ? IN (SELECT roomMembers.userId FROM roomMembers WHERE roomMembers.roomId=messages.toRoomId) GROUP BY messages.toRoomId) ORDER BY messages.timestamp DESC', [req.session.user.id]);
        let userChats = await getUserChats(req.session.user.id);

        res.render('dashboard', { user: req.session.user, roomChats: roomChats, userChats: userChats });
    }
});

app.use('/api', require('./api'));




async function getUserChats(sessionUserId) {
    let chats = await mysql('SELECT * FROM messages WHERE id IN ( SELECT MAX(id) FROM messages WHERE (fromId=? OR toUserId=?) AND toRoomId=-1 GROUP BY fromId ) OR id IN ( SELECT MAX(id) FROM messages WHERE (fromId=? OR toUserId=?) AND toRoomId=-1 GROUP BY toUserId ) ORDER BY timestamp DESC', [sessionUserId, sessionUserId, sessionUserId, sessionUserId]);

    let newChats = [];
    for (let chat of chats) {
        if (chat.fromId == sessionUserId) {
            if (newChats[chat.toUserId]) {
                if (newChats[chat.toUserId].timestamp < chat.timestamp)
                    newChats[chat.toUserId] = chat;
            } else
                newChats[chat.toUserId] = chat;
        } else {
            if (newChats[chat.fromId]) {
                if (newChats[chat.fromId].timestamp < chat.timestamp)
                    newChats[chat.fromId] = chat
            } else
                newChats[chat.fromId] = chat;
        }
    }
    chats = newChats;
    for (let key in chats) {
        if (chats[key]) {
            let chat = chats[key];
            let userData = await mysql('SELECT * FROM users WHERE id=?', [(chat.fromId == sessionUserId ? chat.toUserId : chat.fromId)]);
            let notSeen = await mysql('SELECT COUNT(id) FROM `messages` WHERE seen=0 AND fromId=? AND toUserId=?', [userData[0].id, sessionUserId]);
            chats[key].userData = userData[0];
            chats[key].notSeen = (notSeen[0]['COUNT(id)'] < 100 ? notSeen[0]['COUNT(id)'] : '99+');
        }
    }

    return chats;
}

io.on('connection', function(socket) {
    socket.emit('msg', {
        action : 'setOnline',
        websocket : socket.id
    });

    socket.on('msg', function(data) {
        if (data.to && data.to.length > 0) {
            for (let id of data.to) {
                socket.broadcast.to(id).emit('msg', data);
            }
        }
    });

    socket.on('disconnect', function() {
        mysql('UPDATE users SET websocket="" WHERE websocket=?', [socket.id]);
    });
});