import React from "react";
import { BrowserRouter as Router, Routes, Route, useNavigate } from "react-router-dom";
import APILog from "./components/APILog";
import YCTN from "./components/YCTN";
import SM37 from "./components/SM37";
import SM66 from "./components/SM66"; 
import CHAT from "./components/CHAT"; 
import CHXDGMap from "./components/CHXDGMap"; 


const Home = () => {
  const navigate = useNavigate();

  return (
    <div className="d-flex flex-column align-items-center justify-content-center" style={{ height: "100vh" }}>
      <h2 className="mb-4">Chọn chức năng</h2>
      <div className="d-grid gap-3" style={{ width: "300px" }}>        
        <button className="btn btn-primary btn-lg" onClick={() => navigate("/sm37")}>
          SM37
        </button>
        <button className="btn btn-primary btn-lg" onClick={() => navigate("/sm66")}>
          SM66
        </button>
        <button className="btn btn-primary btn-lg" onClick={() => navigate("/apilog")}>
          API Log
        </button>
        <button className="btn btn-primary btn-lg" onClick={() => navigate("/yctn?maMau=123456789")}>
          YCTN
        </button>
        <button className="btn btn-primary btn-lg" onClick={() => navigate("/chat")}>
          CHAT
        </button>
        <button className="btn btn-primary btn-lg" onClick={() => navigate("/chxd-gmap")}>
          CHXD MAP
        </button>
      </div>
    </div>
  );
};

function App() {
  return (
    <Router basename="/app">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/sm37" element={<SM37 />} />
        <Route path="/sm66" element={<SM66 />} />
        <Route path="/apilog" element={<APILog />} />
        <Route path="/yctn" element={<YCTN />} />        
        <Route path="/chat" element={<CHAT />} />    
        <Route path="/chxd-gmap" element={<CHXDGMap />} />
        <Route path="/chxd-gmap/:CHXD_ID" element={<CHXDGMap />} />
      </Routes>
    </Router>
  );
}

export default App;
