// CẤU HÌNH HỆ THỐNG ĐIỂM DANH GPS
const CONFIG = {
    // Mật khẩu trang quản trị (Admin Panel)
    adminPassword: "admin123",

    // Link xem kết quả trực tiếp
    googleSheetUrl: "#",

    // Endpoint API Backend C# nội bộ để lưu và đọc dữ liệu điểm danh
    googleScriptUrl: "/api",

    // 2. DANH SÁCH CÁC SỰ KIỆN / HOẠT ĐỘNG MẶC ĐỊNH
    activities: []
};

// Hàm lấy danh sách hoạt động (tự động lọc bỏ các sự kiện mẫu cũ nếu còn tồn tại trong bộ nhớ)
function getActivities() {
    const local = localStorage.getItem("gps_attendance_activities");
    if (local) {
        try {
            const parsed = JSON.parse(local);
            if (Array.isArray(parsed)) {
                // Tự động xóa bỏ 3 sự kiện mẫu cũ nếu còn dính trong LocalStorage của máy
                const filtered = parsed.filter(a => a && a.code !== "SVTN2026" && a.code !== "WORKSHOP-AI" && a.code !== "TINHOC-ABC");
                if (filtered.length !== parsed.length) {
                    localStorage.setItem("gps_attendance_activities", JSON.stringify(filtered));
                    return filtered;
                }
                return parsed;
            }
        } catch (e) {
            console.error("Lỗi parse dữ liệu activities từ localStorage, tiến hành reset", e);
            localStorage.removeItem("gps_attendance_activities");
        }
    }
    return CONFIG.activities;
}

// Hàm lưu danh sách hoạt động mới vào localStorage và đồng bộ lên Google Sheet cloud
function saveActivities(list) {
    const cleanList = (list || []).filter(a => a && a.code !== "SVTN2026" && a.code !== "WORKSHOP-AI" && a.code !== "TINHOC-ABC");
    localStorage.setItem("gps_attendance_activities", JSON.stringify(cleanList));
    
    if (CONFIG.googleScriptUrl) {
        const encodedData = encodeURIComponent(JSON.stringify(cleanList));
        
        // 1. Đồng bộ qua GET parameter (Chống lỗi 302 redirect trên di động)
        fetch(CONFIG.googleScriptUrl + '?action=saveActivities&data=' + encodedData + '&_t=' + Date.now())
            .then(res => res.json())
            .then(data => console.log("Đã đồng bộ sự kiện lên Google Sheets (GET):", data))
            .catch(e => console.error("Lỗi đồng bộ GET:", e));

        // 2. Đồng bộ qua POST payload dự phòng
        fetch(CONFIG.googleScriptUrl + '?action=saveActivities', {
            method: 'POST',
            body: JSON.stringify(cleanList)
        }).catch(e => console.error("Lỗi đồng bộ POST:", e));
    }
}

// Đồng bộ danh sách hoạt động từ Google Sheets về LocalStorage (chạy ngầm, chống cache di động)
function syncActivitiesFromCloud(callback) {
    if (!CONFIG.googleScriptUrl) return;
    fetch(CONFIG.googleScriptUrl + "?action=getActivities&_t=" + Date.now())
        .then(res => res.json())
        .then(data => {
            if (Array.isArray(data)) {
                const cleanData = data.filter(a => a && a.code !== "SVTN2026" && a.code !== "WORKSHOP-AI" && a.code !== "TINHOC-ABC");
                localStorage.setItem("gps_attendance_activities", JSON.stringify(cleanData));
                if (callback) callback(cleanData);
            }
        })
        .catch(err => console.error("Lỗi đồng bộ danh sách sự kiện từ cloud:", err));
}

// 3. QUẢN LÝ THÙNG RÁC & KHÔI PHỤC SỰ KIỆN ĐÃ XÓA
function getDeletedActivities() {
    const local = localStorage.getItem("gps_deleted_activities");
    if (local) {
        try {
            const parsed = JSON.parse(local);
            if (Array.isArray(parsed)) return parsed;
        } catch (e) {
            console.error("Lỗi đọc gps_deleted_activities:", e);
        }
    }
    return [];
}

function saveDeletedActivities(list) {
    localStorage.setItem("gps_deleted_activities", JSON.stringify(list || []));
}

function syncDeletedActivitiesFromCloud(callback) {
    if (!CONFIG.googleScriptUrl) return;
    fetch(CONFIG.googleScriptUrl + "?action=getDeletedActivities&_t=" + Date.now())
        .then(res => res.json())
        .then(data => {
            if (Array.isArray(data)) {
                localStorage.setItem("gps_deleted_activities", JSON.stringify(data));
                if (callback) callback(data);
            }
        })
        .catch(err => console.error("Lỗi đồng bộ thùng rác từ cloud:", err));
}

