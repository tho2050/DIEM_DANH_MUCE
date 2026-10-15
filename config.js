// CẤU HÌNH HỆ THỐNG ĐIỂM DANH GPS
const CONFIG = {
    // Mật khẩu trang quản trị (Admin Panel)
    adminPassword: "admin123",

    // Link xem kết quả trực tiếp
    googleSheetUrl: "#",

    // Endpoint API Backend C# nội bộ để lưu và đọc dữ liệu điểm danh
    googleScriptUrl: "/api",

    // Google OAuth 2.0 Client ID để mở cửa sổ đăng nhập Google thật
    googleClientId: "675863164420-46klpnrb8bg631r1qs2eaq32pbrsngs8.apps.googleusercontent.com",

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

// Helper giải mã chuỗi tiêu đề, mã sự kiện bị dính mã hóa URL (%20, %2F, %C3%A9, ...) thành chuỗi chuẩn
function decodeTitleConfig(s) {
    if (!s) return '';
    let res = String(s);
    try {
        while (res.includes('%') && /%[0-9A-Fa-f]{2}/.test(res)) {
            const decoded = decodeURIComponent(res);
            if (decoded === res) break;
            res = decoded;
        }
    } catch (e) {
        res = res.replace(/%20/g, ' ').replace(/%2F/gi, '/');
    }
    return res.replace(/%20/g, ' ').replace(/%2F/gi, '/').trim();
}

// Helper chuẩn hóa mã sự kiện loại bỏ khác biệt dấu gạch, khoảng trắng thừa
function normalizeActivityCode(s) {
    if (!s) return '';
    let res = (typeof decodeTitleConfig === 'function' ? decodeTitleConfig(s) : String(s)).trim().toUpperCase();
    // 1. Chuẩn hóa tất cả các loại gạch ngang (hyphen, en-dash, em-dash, minus) thành '-'
    res = res.replace(/[\u2010-\u2015\u2212–—]/g, '-');
    // 2. Xóa khoảng trắng thừa quanh dấu '-', '/', '(', ')'
    res = res.replace(/\s*-\s*/g, '-').replace(/\s*\/\s*/g, '/').replace(/\s*\(\s*/g, '(').replace(/\s*\)\s*/g, ')');
    // 3. Xóa dấu chấm hoặc khoảng trắng ở cuối chuỗi
    res = res.replace(/[\.\s]+$/, '');
    // 4. Chuẩn hóa khoảng trắng kép
    res = res.replace(/\s+/g, ' ').trim();
    return res;
}

// Helper so sánh 2 mã sự kiện hỗ trợ các biến thể (dấu gạch ngang, khoảng trắng, viết hoa/thường, en-dash, hoặc lỗi gõ phím)
function isSameActivity(codeA, codeB) {
    if (!codeA || !codeB) return false;
    const a = (typeof decodeTitleConfig === 'function' ? decodeTitleConfig(codeA) : String(codeA)).trim().toUpperCase();
    const b = (typeof decodeTitleConfig === 'function' ? decodeTitleConfig(codeB) : String(codeB)).trim().toUpperCase();
    if (a === b) return true;

    const normA = normalizeActivityCode(a);
    const normB = normalizeActivityCode(b);
    if (normA === normB) return true;

    // Chuẩn hóa thay thế '-' và '/' để ngày tháng khớp nhau ('15-10-2026' khớp '15/10/2026')
    const slashA = normA.replace(/-/g, '/');
    const slashB = normB.replace(/-/g, '/');
    if (slashA === slashB) return true;

    // Tương thích tối đa biến thể sự kiện chuyển đổi số chiều 15/10 (15/10–PPHƯỜNG CHIỀU vs 15/10- PHƯỜNG ( CHIỀU ))
    const isPm15_A = (a.includes('15/10') || a.includes('15-10')) && (a.includes('CHIỀU') || a.includes('CHIEU')) && !a.includes('SÁNG') && !a.includes('SANG');
    const isPm15_B = (b.includes('15/10') || b.includes('15-10')) && (b.includes('CHIỀU') || b.includes('CHIEU')) && !b.includes('SÁNG') && !b.includes('SANG');
    if (isPm15_A && isPm15_B) return true;

    // Tương thích sáng 15/10
    const isAm15_A = (a.includes('15/10') || a.includes('15-10')) && (a.includes('SÁNG') || a.includes('SANG'));
    const isAm15_B = (b.includes('15/10') || b.includes('15-10')) && (b.includes('SÁNG') || b.includes('SANG'));
    if (isAm15_A && isAm15_B) return true;

    return false;
}

// Helper chuyển đổi chuỗi ngày giờ sự kiện (ví dụ "18:15 15/10/2026" hoặc "2026-10-15T18:15") thành Date theo múi giờ Việt Nam (UTC+7)
function parseVietnamDate(str) {
    if (!str) return null;
    str = String(str).trim();
    if (!str) return null;

    // Định dạng: 'HH:mm DD/MM/YYYY' hoặc 'HH:mm:ss DD/MM/YYYY'
    let m = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
        const [, hh, mm, ss, d, mo, y] = m;
        return new Date(Date.UTC(parseInt(y), parseInt(mo) - 1, parseInt(d), parseInt(hh) - 7, parseInt(mm), parseInt(ss || 0)));
    }

    // Định dạng: 'DD/MM/YYYY HH:mm' hoặc 'DD/MM/YYYY HH:mm:ss'
    m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (m) {
        const [, d, mo, y, hh, mm, ss] = m;
        return new Date(Date.UTC(parseInt(y), parseInt(mo) - 1, parseInt(d), parseInt(hh) - 7, parseInt(mm), parseInt(ss || 0)));
    }

    // Định dạng ISO: 'YYYY-MM-DDTHH:mm' hoặc 'YYYY-MM-DD HH:mm'
    m = str.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (m) {
        const [, y, mo, d, hh, mm, ss] = m;
        return new Date(Date.UTC(parseInt(y), parseInt(mo) - 1, parseInt(d), parseInt(hh) - 7, parseInt(mm), parseInt(ss || 0)));
    }

    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
}

// Helper kiểm tra trạng thái thời gian điểm danh của sự kiện
function checkActivityTimeStatus(act) {
    if (!act) return { status: 'OPEN', message: '' };
    const now = new Date();
    const startDate = parseVietnamDate(act.startTime);
    const endDate = parseVietnamDate(act.endTime);

    if (endDate && now.getTime() > endDate.getTime()) {
        return {
            status: 'EXPIRED',
            message: `Sự kiện đã kết thúc thời gian điểm danh lúc ${act.endTime || ''}. Cổng điểm danh hiện đã bị KHÓA.`,
            startDate,
            endDate
        };
    }

    if (startDate && now.getTime() < startDate.getTime()) {
        return {
            status: 'NOT_STARTED',
            message: `Chưa đến thời gian điểm danh! Sự kiện sẽ mở cổng vào lúc ${act.startTime || ''}.`,
            startDate,
            endDate
        };
    }

    return {
        status: 'OPEN',
        message: 'Cổng điểm danh đang mở.',
        startDate,
        endDate
    };
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
                    if (a.code) {
                        const cleanC = decodeTitleConfig(a.code);
                        if (cleanC !== a.code) {
                            a.code = cleanC;
                            hasChanges = true;
                        }
                    }
                    if (a.title) {
                        const cleanT = decodeTitleConfig(a.title);
                        if (cleanT !== a.title) {
                            a.title = cleanT;
                            hasChanges = true;
                        }
                    }
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

// Hàm lưu 1 sự kiện đơn lẻ (nguyên tử) - Không ghi đè danh sách toàn cục, an toàn trên nhiều thiết bị
async function saveSingleActivity(activity) {
    if (!activity || !activity.code) return false;
    const cleanAct = { ...activity };
    if (cleanAct.code) cleanAct.code = decodeTitleConfig(cleanAct.code);
    if (cleanAct.title) cleanAct.title = decodeTitleConfig(cleanAct.title);
    if (!cleanAct.createdBy) cleanAct.createdBy = "hongnhung";

    // 1. Cập nhật ngay vào LocalStorage máy hiện tại
    const currentList = getActivities();
    const idx = currentList.findIndex(a => a.code === cleanAct.code);
    if (idx >= 0) currentList[idx] = cleanAct;
    else currentList.unshift(cleanAct);
    localStorage.setItem("gps_attendance_activities", JSON.stringify(currentList));

    // 2. Gửi đồng bộ lên Cloud Backend qua POST JSON an toàn
    if (CONFIG.googleScriptUrl) {
        try {
            const res = await fetch(CONFIG.googleScriptUrl + '?action=saveActivity&_t=' + Date.now(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cleanAct)
            });
            const data = await res.json();
            if (data && Array.isArray(data.activities)) {
                localStorage.setItem("gps_attendance_activities", JSON.stringify(data.activities));
            }
            return true;
        } catch (e) {
            console.error("Lỗi đồng bộ single activity:", e);
        }
    }
    return true;
}

// Hàm lưu danh sách hoạt động mới vào localStorage và đồng bộ lên Cloud Backend
async function saveActivities(list) {
    const cleanList = (list || []).filter(a => a && a.code !== "SVTN2026" && a.code !== "WORKSHOP-AI" && a.code !== "TINHOC-ABC").map(a => {
        if (a && a.code) a.code = decodeTitleConfig(a.code);
        if (a && a.title) a.title = decodeTitleConfig(a.title);
        if (!a.createdBy) a.createdBy = "hongnhung";
        return a;
    });
    localStorage.setItem("gps_attendance_activities", JSON.stringify(cleanList));
    
    if (CONFIG.googleScriptUrl) {
        try {
            const res = await fetch(CONFIG.googleScriptUrl + '?action=saveActivities&_t=' + Date.now(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cleanList)
            });
            const data = await res.json();
            if (data && Array.isArray(data.activities)) {
                localStorage.setItem("gps_attendance_activities", JSON.stringify(data.activities));
            }
        } catch (e) {
            console.error("Lỗi đồng bộ saveActivities:", e);
        }
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
                    if (a && a.code) a.code = decodeTitleConfig(a.code);
                    if (a && a.title) a.title = decodeTitleConfig(a.title);
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

// 3.1. QUẢN LÝ THÙNG RÁC & KHÔI PHỤC SINH VIÊN ĐIỂM DANH ĐÃ XÓA
function getDeletedCheckins() {
    const local = localStorage.getItem("gps_deleted_checkins");
    if (local) {
        try {
            const parsed = JSON.parse(local);
            if (Array.isArray(parsed)) return parsed;
        } catch (e) {
            console.error("Lỗi đọc gps_deleted_checkins:", e);
        }
    }
    return [];
}

function saveDeletedCheckins(list) {
    localStorage.setItem("gps_deleted_checkins", JSON.stringify(list || []));
}

function syncDeletedCheckinsFromCloud(callback) {
    if (!CONFIG.googleScriptUrl) return;
    fetch(CONFIG.googleScriptUrl + "?action=getDeletedCheckins&_t=" + Date.now())
        .then(res => res.json())
        .then(data => {
            if (Array.isArray(data)) {
                localStorage.setItem("gps_deleted_checkins", JSON.stringify(data));
                if (callback) callback(data);
            }
        })
        .catch(err => console.error("Lỗi đồng bộ thùng rác sinh viên từ cloud:", err));
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

