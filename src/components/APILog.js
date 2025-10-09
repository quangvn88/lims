import React, { useState, useEffect } from "react";
import { BASE_URL, API, API_USER, API_PASSWORD } from "../config";
import { getToday, timeToSeconds } from "../utils/common";
import Pagination from "../components/Pagination";

const APILog = () => {
  const [func, setFunc] = useState("");
  const [funcList, setFuncList] = useState([]);
  const [fromDate, setFromDate] = useState(getToday());
  const [toDate, setToDate] = useState(getToday());
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [sortOrder, setSortOrder] = useState("desc");
  const [showHeader, setShowHeader] = useState(true);
  const [detail, setDetail] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const itemsPerPage = 15;

  // Lấy danh sách FUNC
  const fetchFuncList = async () => {
    try {
      const token = btoa(`${API_USER}:${API_PASSWORD}`);
      const res = await fetch(`${BASE_URL}${API}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${token}`,
        },
        body: JSON.stringify({ FUNC: "ZFM_API_FUNC" }),
      });

      const data = await res.json();
      if (Array.isArray(data?.RESPONSE?.T_DATA)) {
        const funcs = [...new Set(data.RESPONSE.T_DATA.map((i) => i.FUNC))].sort((a, b) =>
          a.localeCompare(b, "en", { sensitivity: "base" })
        );
        setFuncList(funcs);
        if (funcs.length > 0 && !func) setFunc(funcs[0]);
      } else setFuncList([]);
    } catch (err) {
      console.error("Lỗi fetchFuncList:", err);
    }
  };

  // Gọi API lấy log
  const fetchLogs = async () => {
    try {
      setLoading(true);
      const token = btoa(`${API_USER}:${API_PASSWORD}`);
      const res = await fetch(`${BASE_URL}${API}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${token}`,
        },
        body: JSON.stringify({
          FUNC: "ZFM_API_LOG",
          DATA: { FUNC: func, FROM_DATE: fromDate, TO_DATE: toDate, SEARCH_VALUE: search },
        }),
      });

      const data = await res.json();
      if (Array.isArray(data)) {
        setLogs(data);
        setTotalRecords(data.length);
      } else {
        setLogs([]);
        setTotalRecords(0);
      }
      setCurrentPage(1);
    } catch (err) {
      console.error("Lỗi gọi API:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFuncList();
  }, []);

  // Mở modal chi tiết
  const openDetailModal = async (id, field) => {
    setShowDetail(true);
    setDetail(null);
    setDetailLoading(true);
    try {
      const token = btoa(`${API_USER}:${API_PASSWORD}`);
      const res = await fetch(`${BASE_URL}${API}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${token}`,
        },
        body: JSON.stringify({ FUNC: "ZFM_API_LOG_FIELD", DATA: { ID: id, FIELD: field } }),
      });
      const data = await res.json();
      setDetail({ field, data });
    } catch (err) {
      console.error("Lỗi fetchLogField:", err);
      setDetail({ field, data: { error: String(err) } });
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetailModal = () => {
    setShowDetail(false);
    setDetail(null);
    setDetailLoading(false);
  };

  // ESC để đóng modal
  useEffect(() => {
    const handleKeyDown = (e) => e.key === "Escape" && closeDetailModal();
    if (showDetail) window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showDetail]);

  // Copy JSON chi tiết
  const handleCopy = async () => {
    const text = detail ? JSON.stringify(detail.data, null, 2) : "";
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const el = document.createElement("textarea");
        el.value = text;
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
    } catch (err) {
      console.error("Copy thất bại:", err);
    }
  };

  // Sort logs theo TIME
  const sortedLogs = [...logs].sort((a, b) => {
    const sa = timeToSeconds(a.TIME);
    const sb = timeToSeconds(b.TIME);
    return sortOrder === "asc" ? sa - sb : sb - sa;
  });

  const totalPages = Math.max(1, Math.ceil(sortedLogs.length / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentLogs = sortedLogs.slice(startIndex, startIndex + itemsPerPage);

  return (
    <div className="container-fluid p-0">
      {/* Header có thể ẩn/hiện */}
      <div className="sticky-top bg-white border-bottom" style={{ zIndex: 1030, top: 0 }}>
        <div className="py-2 px-2 d-flex justify-content-between align-items-center">
          <h4 className="mb-0">API Log</h4>
          <button className="btn btn-outline-secondary btn-sm" onClick={() => setShowHeader(!showHeader)}>
            {showHeader ? "Ẩn bộ lọc ▲" : "Hiện bộ lọc ▼"}
          </button>
        </div>

        {/* Bộ lọc */}
        <div
          className="px-2 overflow-hidden"
          style={{
            maxHeight: showHeader ? "400px" : "0",
            opacity: showHeader ? 1 : 0,
            transition: "all 0.4s ease",
          }}
        >
          <div className="py-3">
            <div className="row g-3 align-items-end">
              <div className="col-md-3">
                <label className="form-label">FUNC</label>
                <select className="form-select" value={func} onChange={(e) => setFunc(e.target.value)}>
                  <option value="">-- Chọn FUNC --</option>
                  {funcList.map((f, idx) => (
                    <option key={idx} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-3">
                <label className="form-label">From Date</label>
                <input type="date" className="form-control" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </div>
              <div className="col-md-3">
                <label className="form-label">To Date</label>
                <input type="date" className="form-control" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </div>
              <div className="col-md-2">
                <label className="form-label">Tìm kiếm</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Tìm kiếm..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="col-md-1 d-grid">
                <button className="btn btn-primary" onClick={fetchLogs} disabled={loading}>
                  {loading ? "..." : "Search"}
                </button>
              </div>
            </div>        
          </div>
        </div>
      </div>

      {/* Tổng số bản ghi - làm nổi bật */}
      <div
        className="px-3 py-2 text-end fw-bold"
        style={{
          backgroundColor: "#f0f8ff", // nền xanh nhạt dịu
          color: "#0d6efd",           // chữ xanh dương
          borderTop: "1px solid #dee2e6",
          borderBottom: "1px solid #dee2e6",
        }}
      >
        Tổng số bản ghi: <span style={{ color: "#d63384" }}>{totalRecords}</span>
      </div>


      {/* Bảng log */}
      <div>
        {currentLogs.length > 0 ? (
          <>
            <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
              <table className="table table-bordered table-hover mb-0">
                <thead className="table-light sticky-top" style={{ top: 0 }}>
                  <tr>
                    <th>Status</th>
                    <th>BODY</th>
                    <th>RESPONSE</th>
                    <th>ID</th>
                    <th>FUNC</th>
                    <th>CATEGORY</th>
                    <th>Date</th>
                    <th>
                      Time
                      <button
                        className="btn btn-sm btn-link p-0 ms-1"
                        onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
                      >
                        {sortOrder === "asc" ? "↑" : "↓"}
                      </button>
                    </th>
                    <th>IP</th>
                  </tr>
                </thead>
                <tbody>
                  {currentLogs.map((log) => (
                    <tr key={log._ID}>
                      <td>
                        {String(log.STATUSCODE) === "200" ? (
                          <span className="text-success">
                            <i className="bi bi-check-circle-fill"></i> {log.STATUSCODE}
                          </span>
                        ) : (
                          <span className="text-danger">
                            <i className="bi bi-x-circle-fill"></i> {log.STATUSCODE}
                          </span>
                        )}
                      </td>
                      <td
                        onClick={() => openDetailModal(log._ID, "body")}
                        title="Xem BODY"
                        style={{ cursor: "pointer" }}
                      >
                        (xem)
                      </td>
                      <td
                        onClick={() => openDetailModal(log._ID, "responseBody")}
                        title="Xem RESPONSE"
                        style={{ cursor: "pointer" }}
                      >
                        (xem)
                      </td>
                      <td>{log._ID}</td>
                      <td>{log.FUNC}</td>
                      <td>{log.CATEGORY_TYPE}</td>
                      <td>{log.DATE}</td>
                      <td>{log.TIME}</td>
                      <td>{log.IP}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
          </>
        ) : (
          !loading && <p className="text-muted p-3">Không có dữ liệu</p>
        )}
      </div>

      {/* Modal chi tiết */}
      {showDetail && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2000,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={closeDetailModal}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "90%",
              maxHeight: "90vh",
              overflow: "auto",
              background: "#fff",
              borderRadius: 6,
              boxShadow: "0 6px 30px rgba(0,0,0,0.2)",
              padding: 16,
            }}
          >
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h5 className="mb-0">Chi tiết {detail?.field?.toUpperCase()}</h5>
              <div>
                <button className="btn btn-secondary btn-sm me-2" onClick={handleCopy}>
                  Copy
                </button>
                <button className="btn btn-outline-secondary btn-sm" onClick={closeDetailModal}>
                  Close
                </button>
              </div>
            </div>
            <div style={{ background: "#e9f7fa", padding: 12, borderRadius: 4 }}>
              {detailLoading ? (
                <div>Loading...</div>
              ) : detail ? (
                <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(detail.data, null, 2)}</pre>
              ) : (
                <div>No detail</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default APILog;
