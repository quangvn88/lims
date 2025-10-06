import React from "react";

const Pagination = ({ currentPage, totalPages, onPageChange }) => {
  const pageGroupSize = 5;
  const groupStart =
    Math.floor((currentPage - 1) / pageGroupSize) * pageGroupSize + 1;
  const groupEnd = Math.min(groupStart + pageGroupSize - 1, totalPages);

  return (
    <div className="p-3">
      <nav>
        <ul className="pagination justify-content-center mb-0">
          {/* First */}
          <li className={`page-item ${currentPage === 1 ? "disabled" : ""}`}>
            <button className="page-link" onClick={() => onPageChange(1)}>
              « First
            </button>
          </li>

          {/* Previous */}
          <li className={`page-item ${currentPage === 1 ? "disabled" : ""}`}>
            <button
              className="page-link"
              onClick={() => onPageChange(Math.max(currentPage - 1, 1))}
            >
              ‹ Prev
            </button>
          </li>

          {/* Page numbers */}
          {Array.from({ length: groupEnd - groupStart + 1 }, (_, i) => {
            const page = groupStart + i;
            return (
              <li
                key={page}
                className={`page-item ${currentPage === page ? "active" : ""}`}
              >
                <button className="page-link" onClick={() => onPageChange(page)}>
                  {page}
                </button>
              </li>
            );
          })}

          {/* Next */}
          <li
            className={`page-item ${currentPage === totalPages ? "disabled" : ""}`}
          >
            <button
              className="page-link"
              onClick={() => onPageChange(Math.min(currentPage + 1, totalPages))}
            >
              Next ›
            </button>
          </li>

          {/* Last */}
          <li
            className={`page-item ${currentPage === totalPages ? "disabled" : ""}`}
          >
            <button className="page-link" onClick={() => onPageChange(totalPages)}>
              Last »
            </button>
          </li>
        </ul>

        {/* Hiển thị số trang */}
        <div className="text-center mt-2">
          Trang {currentPage} / {totalPages}
        </div>
      </nav>
    </div>
  );
};

export default Pagination;
