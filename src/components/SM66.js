import React, { useState, useEffect } from "react";
import { BASE_URL, API, API_USER, API_PASSWORD } from "../config";
import { getToday } from "../utils/common";

const SM66 = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "asc" });

  // Gọi API danh sách job SM66
  const fetchData = async () => {
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
          FUNC: "ZFM_SM66_LIST",
          DATA: { I_DATE_F: getToday() },
        }),
      });

      const result = await res.json();
      console.log("SM66 API result:", result);
      if (Array.isArray(result.RESPONSE.T_DATA)) {
        setData(result.RESPONSE.T_DATA);
      } else {
        setData([]);
      }
    } catch (err) {
      console.error("Lỗi gọi API:", err);
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // --- SORT ---
  const handleSort = (key) => {
    let direction = "asc";
    if (sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  const sortedData = React.useMemo(() => {
    let sortableData = [...data];
    if (sortConfig.key !== null) {
      sortableData.sort((a, b) => {
        const valA = a[sortConfig.key];
        const valB = b[sortConfig.key];
        if (!isNaN(valA) && !isNaN(valB)) {
          // sort theo số
          return sortConfig.direction === "asc"
            ? Number(valA) - Number(valB)
            : Number(valB) - Number(valA);
        } else {
          // sort theo chữ
          return sortConfig.direction === "asc"
            ? String(valA).localeCompare(String(valB))
            : String(valB).localeCompare(String(valA));
        }
      });
    }
    return sortableData;
  }, [data, sortConfig]);

  const getSortIcon = (key) => {
    if (sortConfig.key !== key) return "⇅";
    return sortConfig.direction === "asc" ? "↑" : "↓";
  };

  return (
    <div className="container-fluid p-0">
      {/* Header */}
      <div
        className="sticky-top bg-white border-bottom"
        style={{ zIndex: 1030, top: 0 }}
      >
        <div className="py-3 px-2">
          <h4 className="mb-3">SM66 - Work Process Overview</h4>
          <div className="row g-3 align-items-end">
            <div className="col-md-3 d-grid">
              <button
                className="btn btn-primary"
                onClick={fetchData}
                disabled={loading}
              >
                {loading ? "Loading..." : "Reload"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Table dữ liệu */}
      <div>
        {sortedData.length > 0 ? (
          <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
            <table className="table table-bordered table-hover mb-0">
              <thead className="table-light sticky-top" style={{ top: 0 }}>
                <tr>
                  <th style={{ width: "40px", textAlign: "center" }}>⚠</th>
                  <th onClick={() => handleSort("WP_TYP")} style={{ cursor: "pointer" }}>
                    WP_TYP {getSortIcon("WP_TYP")}
                  </th>
                  <th onClick={() => handleSort("WP_STATUS")} style={{ cursor: "pointer" }}>
                    WP_STATUS {getSortIcon("WP_STATUS")}
                  </th>
                  <th onClick={() => handleSort("WP_WAITING")} style={{ cursor: "pointer" }}>
                    WP_WAITING {getSortIcon("WP_WAITING")}
                  </th>
                  <th onClick={() => handleSort("WP_ELTIME")} style={{ cursor: "pointer" }}>
                    WP_ELTIME {getSortIcon("WP_ELTIME")}
                  </th>
                  <th onClick={() => handleSort("WP_BNAME")} style={{ cursor: "pointer" }}>
                    WP_BNAME {getSortIcon("WP_BNAME")}
                  </th>
                  <th onClick={() => handleSort("WP_REPORT")} style={{ cursor: "pointer" }}>
                    WP_REPORT {getSortIcon("WP_REPORT")}
                  </th>
                  <th onClick={() => handleSort("WP_ACTION")} style={{ cursor: "pointer" }}>
                    WP_ACTION {getSortIcon("WP_ACTION")}
                  </th>
                  <th onClick={() => handleSort("WP_TABLE")} style={{ cursor: "pointer" }}>
                    WP_TABLE {getSortIcon("WP_TABLE")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedData.map((log, idx) => (
                  <tr key={idx}>
                    <td style={{ textAlign: "center" }}>
                      {Number(log.WP_ELTIME) > 200 && (
                        <span className="text-danger">
                          <i className="bi bi-exclamation-circle-fill"></i>
                        </span>
                      )}
                    </td>
                    <td>{log.WP_TYP}</td>
                    <td>{log.WP_STATUS}</td>
                    <td>{log.WP_WAITING}</td>
                    <td>{log.WP_ELTIME}</td>
                    <td>{log.WP_BNAME}</td>
                    <td>{log.WP_REPORT}</td>
                    <td>{log.WP_ACTION}</td>
                    <td>{log.WP_TABLE}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !loading && <p className="text-muted p-3">Không có dữ liệu</p>
        )}
      </div>
    </div>
  );
};

export default SM66;
