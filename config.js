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
// Hàm format tên tài khoản người tạo: chỉ riêng hongnhung2050py@gmail.com hiển thị "hongnhung", các tài khoản khác hiển thị đầy đủ
function formatCreatorName(creator) {
    if (!creator) return 'hongnhung';
    const s = String(creator).trim();
    const lower = s.toLowerCase();
    if (lower === 'hongnhung2050py@gmail.com' || lower === 'hongnhung2050@gmail.com' || lower === 'hongnhung2050qgmail.con' || lower === 'hongnhung2050py') {
        return 'hongnhung';
    }
    return s;
}

// Hàm lấy danh sách hoạt động (tự động lọc bỏ các sự kiện mẫu cũ nếu còn tồn tại trong bộ nhớ)
function getActivities() {
    const local = localStorage.getItem("gps_attendance_activities");
    if (local) {
        try {
            const parsed = JSON.parse(local);
            if (Array.isArray(parsed)) {
                // Tự động xóa bỏ 3 sự kiện mẫu cũ nếu còn dính trong LocalStorage của máy
                const filtered = parsed.filter(a => a && a.code !== "SVTN2026" && a.code !== "WORKSHOP-AI" && a.code !== "TINHOC-ABC");
                let hasChanges = false;
                filtered.forEach(a => {
                    if (!a.createdBy) {
                        a.createdBy = "hongnhung";
                        hasChanges = true;
                    }
                });
                if (hasChanges || filtered.length !== parsed.length) {
                    localStorage.setItem("gps_attendance_activities", JSON.stringify(filtered));
                }
                return filtered;
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
    const cleanList = (list || []).filter(a => a && a.code !== "SVTN2026" && a.code !== "WORKSHOP-AI" && a.code !== "TINHOC-ABC").map(a => {
        if (!a.createdBy) a.createdBy = "hongnhung";
        return a;
    });
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
                const cleanData = data.filter(a => a && a.code !== "SVTN2026" && a.code !== "WORKSHOP-AI" && a.code !== "TINHOC-ABC").map(a => {
                    if (!a.createdBy) a.createdBy = "hongnhung";
                    return a;
                });
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

// 4. BẢNG TRA CỨU & TỰ ĐỘNG NHẬN DIỆN KHOA DỰA TRÊN KÝ HIỆU LỚP
function detectFacultyFromClassName(className) {
    if (!className) return '';
    const raw = String(className).trim();
    // Chuẩn hóa: Bỏ khoảng trắng, dấu gạch nối, dấu chấm để so sánh chuẩn
    const s = raw.toUpperCase().replace(/[\s\-_.]/g, '');

    // 1. Khoa Kỹ thuật Công nghệ:
    // - CTC: Công nghệ thông tin (D21CTC1..D26CTC1, CNTT)
    // - COK: Công nghệ kỹ thuật ô tô (D23COK1..D26COK2, Ô tô)
    // - TDK: Kỹ thuật điều khiển và tự động hóa (D23TDK1..D26TDK1)
    if (s.includes('CTC') || s.includes('COK') || s.includes('TDK') || 
        s.includes('CNTT') || s.includes('TINHOC') || s.includes('CONGNGHETHONGTIN') || 
        s.includes('OTO') || s.includes('TUDONG') || s.includes('DIENTU') || s.includes('COKHI')) {
        return "Khoa Kỹ thuật Công nghệ";
    }

    // 2. Khoa Kiến trúc:
    // - KTR: Kiến trúc (D20KTR1..D26KTR1)
    // - KNT: Kiến trúc nội thất (D21KNT1..D25KNT1)
    // - QDC: Quản lý đô thị và công trình (D22QDC1)
    if (s.includes('KTR') || s.includes('KNT') || s.includes('QDC') || 
        s.includes('KIENTRUC') || s.includes('NOITHAT') || s.includes('DOHOA')) {
        return "Khoa Kiến trúc";
    }

    // 3. Khoa Kinh tế:
    // - KXC, KXK, KX: Kinh tế xây dựng (D18KX1, D20KXC1..D24KXC1, D25KXK1, D26KXK1)
    // - QXC, QXK, QX: Quản lý xây dựng (D17QX, D20QXC1..D24QXC1, D25QXK1)
    // - KDC, KT: Kế toán (D18KT1, D21KDC1..D25KDC1)
    // - QHC, QSC: Quản trị kinh doanh (D21QHC1..D26QHC1, D23QSC1)
    // - LQC: Logistics và Quản lý chuỗi cung ứng (D23LQC1..D26LQC1)
    // - TNC: Tài chính - Ngân hàng (D23TNC1..D25TNC1)
    // - TMC: Thương mại điện tử (D24TMC1, D25TMC1)
    if (s.includes('KXC') || s.includes('KXK') || s.includes('QXC') || s.includes('QXK') || 
        s.includes('KDC') || s.includes('QHC') || s.includes('QSC') || s.includes('LQC') || 
        s.includes('TNC') || s.includes('TMC') || s.includes('KINHTE') || s.includes('KETOAN') || 
        s.includes('QTKD') || s.includes('LOGISTICS') || s.includes('TAICHINH') || 
        s.includes('NGANHANG') || s.includes('THUONGMAI')) {
        return "Khoa Kinh tế";
    }
    // Nhận diện mã 2 ký tự của Khoa Kinh tế khi đi kèm tiền tố/hậu tố khóa (D18KX1, D17QX, D18KT1...)
    if (/D\d*(KX|QX|KT)\d*/i.test(s) || /^(KX|QX|KT)\d*/i.test(s)) {
        return "Khoa Kinh tế";
    }

    // 4. Khoa Xây dựng:
    // - X, XDK, XCK, XNK: Kỹ thuật xây dựng (D17X1, D18X1..4, D19X1..4, D20XDK1..5, D21XDK1..D26XDK3, D21XCK1, D22XCK1, D23XNK1)
    // - CD, CDK: Cầu đường (D18CD1, D20CDK1..D26CDK1)
    // - CTN, CNK: Kỹ thuật cấp thoát nước (D18CTN1, D19CTN1, D21CNK1..D26CNK1)
    if (s.includes('XDK') || s.includes('XCK') || s.includes('XNK') || 
        s.includes('CDK') || s.includes('CTN') || s.includes('CNK') || 
        s.includes('XAYDUNG') || s.includes('CAUDUONG') || s.includes('CAPTHOATNUOC')) {
        return "Khoa Xây dựng";
    }
    // Nhận diện các lớp D17X1, D18X1..4, D19X1..4, D18CD1
    if (/D\d*(CD|X)\d*/i.test(s) || /^(CD|X)\d+/i.test(s)) {
        return "Khoa Xây dựng";
    }

    return '';
}

