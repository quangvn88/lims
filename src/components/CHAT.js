import React, { useState } from "react";
import ChatRoom from "./ChatRoom";
import "../App.css";

function CHAT() {
  const [joined, setJoined] = useState(false);
  const [user, setUser] = useState("");
  const [roomId, setRoomId] = useState("");

  return (
    <div className="chat">
      {!joined ? (
        <div className="join-box">
          <h2>Realtime Chat</h2>
          <input
            placeholder="Tên của bạn"
            value={user}
            onChange={(e) => setUser(e.target.value)}
          />
          <input
            placeholder="Room ID (ví dụ: general)"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
          />
          <button
            onClick={() => {
              if (!user.trim() || !roomId.trim()) return alert("Nhập user và room");
              setJoined(true);
            }}
          >
            Vào phòng
          </button>
        </div>
      ) : (
        <ChatRoom user={user} roomId={roomId} onLeave={() => setJoined(false)} />
      )}
    </div>
  );
}

export default CHAT;
