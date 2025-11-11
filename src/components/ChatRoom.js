import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import axios from "axios";
import { Modal } from "antd";

const SERVER_URL =
  process.env.REACT_APP_SERVER_URL_CHAT || "http://erp.petrolimex.com.vn:8001";

export default function ChatRoom({ user, roomId, onLeave }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [zoomImage, setZoomImage] = useState(null);
  const listRef = useRef(null);
  const socketRef = useRef(null);
  const connectedRef = useRef(false);

  // 🔌 Connect socket
  useEffect(() => {
    if (connectedRef.current) return;
    connectedRef.current = true;

    const socket = io(SERVER_URL, {
      transports: ["websocket"],
      secure: SERVER_URL.startsWith("https"),
      reconnection: true,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("✅ Connected to socket:", SERVER_URL);
      socket.emit("join_room", { roomId, user });
    });

    socket.on("connect_error", (err) => {
      console.error("❌ Socket connect error:", err.message);
    });

    socket.on("room_history", (history) => {
      setMessages(history || []);
      scrollToBottom();
    });

    socket.on("receive_message", (msg) => {
      setMessages((prev) => [...prev, msg]);
      scrollToBottom();
    });

    return () => {
      socket.off("receive_message");
      socket.off("room_history");
      socket.disconnect();
      connectedRef.current = false;
    };
  }, [roomId, user]);

  // 📋 Dán ảnh
  useEffect(() => {
    const handlePaste = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          setFile(blob);
          setPreview(URL.createObjectURL(blob));
          e.preventDefault();
          break;
        }
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  const scrollToBottom = () => {
    setTimeout(() => {
      if (listRef.current) {
        listRef.current.scrollTo({
          top: listRef.current.scrollHeight,
          behavior: "smooth",
        });
      }
    }, 100);
  };

  // 🚀 Gửi tin nhắn
  const sendMessage = async () => {
    if (!input.trim() && !file) return;

    let imageUrl = null;
    if (file) {
      const formData = new FormData();
      formData.append("image", file);

      try {
        const res = await axios.post(`${SERVER_URL}/upload`, formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        imageUrl = res.data.fileUrl;
      } catch (err) {
        console.error("Upload error:", err);
      }

      setFile(null);
      setPreview(null);
    }

    const msg = {
      roomId,
      user,
      text: input.trim(),
      image: imageUrl,
      time: new Date().toISOString(),
    };

    // ❌ Không thêm message local nữa — server sẽ gửi lại
    socketRef.current?.emit("send_message", msg);
    setInput("");
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="chat-room">
      <div className="chat-header">
        <div>
          <strong>Phòng:</strong> {roomId}
        </div>
        <div>
          <strong>Người dùng:</strong> {user}
        </div>
        <button onClick={onLeave} className="leave-btn">
          Rời
        </button>
      </div>

      <div className="message-list" ref={listRef}>
        {messages.map((m, i) => {
          const isMine = m.user === user;
          const isSystem = m.user === "System";
          if (isSystem) {
            return (
              <div key={i} className="message system">
                <span className="system-text">── {m.text} ──</span>
              </div>
            );
          }

          return (
            <div key={i} className={`message ${isMine ? "mine" : "other"}`}>
              <div className="meta">
                <span>{m.user}</span>
                <span>{new Date(m.time).toLocaleTimeString()}</span>
              </div>
              {m.text && <div className="text">{m.text}</div>}
              {m.image && (
                <img
                  src={m.image}
                  alt="img"
                  className="chat-image"
                  onClick={() => setZoomImage(m.image)}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Nhập tin nhắn hoặc dán ảnh (Ctrl+V)..."
          rows={2}
        />
        <button onClick={sendMessage}>Gửi</button>
      </div>

      {preview && (
        <div className="preview-box">
          <img src={preview} alt="preview" className="preview-img" />
          <button
            onClick={() => {
              setFile(null);
              setPreview(null);
            }}
          >
            ✖
          </button>
        </div>
      )}

      <Modal
        open={!!zoomImage}
        footer={null}
        closable={false}
        centered
        onCancel={() => setZoomImage(null)}
        width="100vw"
        style={{ top: 0, padding: 0 }}
        bodyStyle={{
          background: "rgba(0,0,0,0.9)",
          height: "100vh",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        {zoomImage && (
          <img
            src={zoomImage}
            alt="zoomed"
            style={{
              maxWidth: "95vw",
              maxHeight: "95vh",
              borderRadius: 10,
              objectFit: "contain",
              cursor: "zoom-out",
            }}
            onClick={() => setZoomImage(null)}
          />
        )}
      </Modal>
    </div>
  );
}
