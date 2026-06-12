import { Routes, Route } from "react-router-dom";
import { Room } from "./components/Room";
import { RoomList } from "./components/RoomList";
import { Login } from "./components/Login";
import { Register } from "./components/Register";
import "./App.css";

function App() {
  return (
    <Routes>
      <Route path="/" element={<RoomList />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/room/:roomId" element={<Room />} />
    </Routes>
  );
}

export default App;
