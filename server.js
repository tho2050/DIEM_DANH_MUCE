process.env.TZ = 'Asia/Ho_Chi_Minh';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Pool } = require('pg');

// Helper định dạng ngày giờ chuẩn Việt Nam (UTC+7 / Asia/Ho_Chi_Minh)
function getVietnamTimestamp(d = new Date()) {
    try {
        const dateObj = (d instanceof Date) ? d : new Date(d);
        if (isNaN(dateObj.getTime())) {
            return new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
        }
        const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Ho_Chi_Minh',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour12: false
        }).formatToParts(dateObj);
        const map = {};
        parts.forEach(p => map[p.type] = p.value);
        return `${map.hour}:${map.minute}:${map.second} ${map.day}/${map.month}/${map.year}`;
    } catch (e) {
        return new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
    }
}

const PORT = process.env.PORT || 5252;
const DATABASE_URL = process.env.DATABASE_URL;

const DATA_DIR = path.join(__dirname, 'App_Data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const ACTIVITIES_FILE = path.join(DATA_DIR, 'activities.json');
const RECORDS_FILE = path.join(DATA_DIR, 'records.json');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const CONFIG_FILE = path.join(DATA_DIR, 'admin_config.json');

// Khởi tạo PostgreSQL Pool nếu có DATABASE_URL
let pool = null;
if (DATABASE_URL) {
    console.log('Đang kết nối tới PostgreSQL Database...');
    pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1') ? false : { rejectUnauthorized: false }
    });

    // Tạo bảng tự động nếu chưa tồn tại
    const initDbSql = `
        CREATE TABLE IF NOT EXISTS activities (
            code VARCHAR(100) PRIMARY KEY,
            title TEXT,
            description TEXT,
            location_address TEXT,
            latitude DOUBLE PRECISION,
            longitude DOUBLE PRECISION,
            radius_meters INT,
            start_time TEXT,
            end_time TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS checkins (
            id SERIAL PRIMARY KEY,
            timestamp TEXT,
            code VARCHAR(100),
            title TEXT,
            student_code VARCHAR(50),
            name TEXT,
            class_name TEXT,
            faculty TEXT,
            phone_number TEXT,
            email TEXT,
            coords TEXT,
            distance TEXT,
            device TEXT,
            ip TEXT,
            device_uuid TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS accounts (
            username VARCHAR(100) PRIMARY KEY,
            password TEXT NOT NULL,
            role VARCHAR(20) NOT NULL DEFAULT 'staff',
            status VARCHAR(20) NOT NULL DEFAULT 'approved',
            reg_date TEXT,
            is_default BOOLEAN DEFAULT FALSE,
            otp_code VARCHAR(10)
        );

        CREATE TABLE IF NOT EXISTS system_config (
            key_name VARCHAR(100) PRIMARY KEY,
            value_text TEXT
        );
    `;

    pool.query(initDbSql)
        .then(async () => {
            console.log('✅ Khởi tạo PostgreSQL Database (Bảng activities, checkins, accounts, system_config) thành công!');
            // Seed tài khoản mặc định admin nếu chưa có
            try {
                const res = await pool.query("SELECT COUNT(*) FROM accounts");
                if (parseInt(res.rows[0].count) === 0) {
                    await pool.query(
                        "INSERT INTO accounts (username, password, role, status, reg_date, is_default) VALUES ($1, $2, $3, $4, $5, $6)",
                        ['admin', 'admin123', 'super', 'approved', 'Hệ thống mặc định', true]
                    );
                    console.log('✅ Đã tạo tài khoản khởi tạo: admin / admin123 (Super Admin)');
                }
            } catch (e) {
                console.error("Lỗi seed tài khoản mặc định:", e);
            }

            // Tự động chuẩn hóa thời gian về giờ Việt Nam (UTC+7) cho các bản ghi cũ nếu trước đây lưu giờ UTC
            try {
                await pool.query(`
                    UPDATE checkins 
                    SET timestamp = to_char(created_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI:SS DD/MM/YYYY')
                    WHERE created_at IS NOT NULL AND (
                        timestamp IS NULL 
                        OR timestamp = '' 
                        OR timestamp ~ '^[0-9]{2}:[0-9]{2}:[0-9]{2}$'
                    );
                `);
            } catch (e) {
                console.error("Lỗi đồng bộ múi giờ Việt Nam trong SQL:", e);
            }
        })
        .catch(err => console.error('❌ Lỗi khởi tạo PostgreSQL Tables:', err));
} else {
    console.log('ℹ️ Không tìm thấy DATABASE_URL, đang chạy chế độ lưu file JSON nội bộ.');
}

function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

// Helpers lấy/lưu dữ liệu sự kiện
async function dbGetActivities() {
    if (pool) {
        try {
            const res = await pool.query('SELECT code, title, description, location_address as "locationAddress", latitude, longitude, radius_meters as "radiusMeters", start_time as "startTime", end_time as "endTime" FROM activities ORDER BY created_at DESC');
            return res.rows;
        } catch (e) { console.error('Lỗi đọc activities từ SQL:', e); }
    }
    if (fs.existsSync(ACTIVITIES_FILE)) {
        try { return JSON.parse(fs.readFileSync(ACTIVITIES_FILE, 'utf8')); } catch (e) {}
    }
    return [];
}

async function dbSaveActivities(activitiesList) {
    if (pool) {
        try {
            const validCodes = (activitiesList || []).map(a => a ? a.code : null).filter(Boolean);
            if (validCodes.length > 0) {
                await pool.query('DELETE FROM activities WHERE code NOT IN (' + validCodes.map((_, i) => '$' + (i + 1)).join(',') + ')', validCodes);
            } else {
                await pool.query('DELETE FROM activities');
            }

            for (const act of activitiesList) {
                if (!act || !act.code) continue;
                await pool.query(`
                    INSERT INTO activities (code, title, description, location_address, latitude, longitude, radius_meters, start_time, end_time)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    ON CONFLICT (code) DO UPDATE SET
                        title = EXCLUDED.title,
                        description = EXCLUDED.description,
                        location_address = EXCLUDED.location_address,
                        latitude = EXCLUDED.latitude,
                        longitude = EXCLUDED.longitude,
                        radius_meters = EXCLUDED.radius_meters,
                        start_time = EXCLUDED.start_time,
                        end_time = EXCLUDED.end_time;
                `, [
                    act.code, act.title || '', act.description || '', act.locationAddress || '',
                    parseFloat(act.latitude) || 0, parseFloat(act.longitude) || 0,
                    parseInt(act.radiusMeters) || 50, act.startTime || '', act.endTime || ''
                ]);
            }
            return true;
        } catch (e) { console.error('Lỗi ghi activities vào SQL:', e); }
    }
    fs.writeFileSync(ACTIVITIES_FILE, JSON.stringify(activitiesList, null, 2), 'utf8');
    return true;
}

async function dbDeleteActivity(code) {
    if (!code) return true;
    if (pool) {
        try {
            await pool.query('DELETE FROM activities WHERE code = $1', [code]);
            return true;
        } catch (e) { console.error('Lỗi delete activity SQL:', e); }
    }
    if (fs.existsSync(ACTIVITIES_FILE)) {
        try {
            let list = JSON.parse(fs.readFileSync(ACTIVITIES_FILE, 'utf8'));
            list = list.filter(a => a.code !== code);
            fs.writeFileSync(ACTIVITIES_FILE, JSON.stringify(list, null, 2), 'utf8');
        } catch (e) {}
    }
    return true;
}

function getFacultyPriority(facultyName) {
    if (!facultyName) return 99;
    const f = String(facultyName).toLowerCase().trim();
    // 1. Khoa Kỹ thuật Công nghệ (hoặc Công nghệ thông tin / CNTT)
    if (f.includes('kỹ thuật') || f.includes('công nghệ') || f.includes('cntt') || f.includes('tin học')) {
        return 1;
    }
    // 2. Khoa Kinh tế
    if (f.includes('kinh tế') || f.includes('kinh te') || f.includes('qtkd')) {
        return 2;
    }
    // 3. Khoa Xây dựng
    if (f.includes('xây dựng') || f.includes('xay dung')) {
        return 3;
    }
    // 4. Khoa Kiến trúc
    if (f.includes('kiến trúc') || f.includes('kien truc') || f.includes('quy hoạch')) {
        return 4;
    }
    return 10;
}

function sortAttendanceRecords(records, activities = []) {
    if (!Array.isArray(records) || records.length === 0) return records;

    const eventOrderMap = {};
    if (Array.isArray(activities)) {
        activities.forEach((act, idx) => {
            if (act && act.code) {
                eventOrderMap[String(act.code).trim().toUpperCase()] = idx;
            }
        });
    }

    const eventMaxIdMap = {};
    records.forEach(r => {
        const code = String(r.code || '').trim().toUpperCase();
        const id = parseInt(r.id) || 0;
        if (!eventMaxIdMap[code] || id > eventMaxIdMap[code]) {
            eventMaxIdMap[code] = id;
        }
    });

    const unrankedEvents = Object.keys(eventMaxIdMap)
        .filter(code => eventOrderMap[code] === undefined)
        .sort((a, b) => eventMaxIdMap[b] - eventMaxIdMap[a]);

    let startRank = Object.keys(eventOrderMap).length;
    unrankedEvents.forEach(code => {
        eventOrderMap[code] = startRank++;
    });

    return records.slice().sort((a, b) => {
        const codeA = String(a.code || '').trim().toUpperCase();
        const codeB = String(b.code || '').trim().toUpperCase();

        // 1. Gom nhóm theo Sự kiện
        if (codeA !== codeB) {
            const rankA = eventOrderMap[codeA] !== undefined ? eventOrderMap[codeA] : 99999;
            const rankB = eventOrderMap[codeB] !== undefined ? eventOrderMap[codeB] : 99999;
            if (rankA !== rankB) return rankA - rankB;
            return codeA.localeCompare(codeB);
        }

        // 2. Trong 1 sự kiện -> Cố định theo Khoa:
        //    1. Khoa Kỹ thuật Công nghệ (CNTT)
        //    2. Khoa Kinh tế
        //    3. Khoa Xây dựng
        //    4. Khoa Kiến trúc
        const facA = getFacultyPriority(a.faculty);
        const facB = getFacultyPriority(b.faculty);
        if (facA !== facB) {
            return facA - facB;
        }

        // 3. Trong 1 Khoa -> Lớp giống nhau xếp gần nhau (A-Z)
        const classA = String(a.className || '').trim().toUpperCase();
        const classB = String(b.className || '').trim().toUpperCase();
        if (classA !== classB) {
            if (!classA) return 1;
            if (!classB) return -1;
            return classA.localeCompare(classB, 'vi', { numeric: true, sensitivity: 'base' });
        }

        // 4. Trong cùng 1 Lớp -> ID lớn hơn hoặc mới nhất xếp lên trước
        const idA = parseInt(a.id) || 0;
        const idB = parseInt(b.id) || 0;
        if (idA !== idB) return idB - idA;

        const timeA = String(a.timestamp || '');
        const timeB = String(b.timestamp || '');
        if (timeA !== timeB) return timeB.localeCompare(timeA);

        return String(a.studentCode || '').localeCompare(String(b.studentCode || ''));
    });
}

// Helpers lấy/lưu điểm danh
async function dbGetCheckins() {
    let rows = [];
    if (pool) {
        try {
            const res = await pool.query('SELECT id, timestamp, code, title, student_code as "studentCode", name, class_name as "className", faculty, phone_number as "phoneNumber", email, coords, distance, device, ip, device_uuid as "deviceUuid", created_at as "createdAt" FROM checkins ORDER BY id DESC');
            rows = res.rows.map(r => {
                // Đảm bảo thời gian hiển thị luôn chuẩn giờ Việt Nam
                if (r.createdAt && (!r.timestamp || r.timestamp.trim() === '' || /^\d{2}:\d{2}:\d{2}$/.test(r.timestamp.trim()))) {
                    r.timestamp = getVietnamTimestamp(r.createdAt);
                }
                return r;
            });
        } catch (e) { console.error('Lỗi đọc checkins từ SQL:', e); }
    } else if (fs.existsSync(RECORDS_FILE)) {
        try { rows = JSON.parse(fs.readFileSync(RECORDS_FILE, 'utf8')); } catch (e) {}
    }
    const activities = await dbGetActivities();
    return sortAttendanceRecords(rows, activities);
}

async function dbUpdateCheckin(record) {
    if (pool && record.id) {
        try {
            await pool.query(`
                UPDATE checkins SET
                    timestamp = $1, code = $2, title = $3, student_code = $4,
                    name = $5, class_name = $6, faculty = $7, phone_number = $8,
                    email = $9, distance = $10
                WHERE id = $11
            `, [
                record.timestamp || '', record.code || '', record.title || '',
                record.studentCode || '', record.name || '', record.className || '',
                record.faculty || '', record.phoneNumber || '', record.email || '',
                record.distance !== undefined ? record.distance : 'Bổ sung thủ công (Admin)', record.id
            ]);
            return { status: 'success', message: 'Đã cập nhật lượt điểm danh thành công!' };
        } catch (e) { console.error('Lỗi update checkin SQL:', e); }
    }
    let list = await dbGetCheckins();
    const idx = list.findIndex(r => (record.id && r.id == record.id) || (r.studentCode === record.studentCode && r.code === record.code));
    if (idx !== -1) {
        list[idx] = { ...list[idx], ...record };
        fs.writeFileSync(RECORDS_FILE, JSON.stringify(list, null, 2), 'utf8');
    }
    return { status: 'success', message: 'Đã cập nhật bản ghi điểm danh!' };
}

async function dbDeleteCheckinRecord(id, studentCode, code) {
    if (pool) {
        try {
            if (id) {
                await pool.query('DELETE FROM checkins WHERE id = $1', [id]);
            } else if (studentCode && code) {
                await pool.query('DELETE FROM checkins WHERE student_code = $1 AND code = $2', [studentCode, code]);
            }
            return { status: 'success', message: 'Đã xóa lượt điểm danh thành công!' };
        } catch (e) { console.error('Lỗi delete checkin SQL:', e); }
    }
    let list = await dbGetCheckins();
    list = list.filter(r => r.id != id && !(r.studentCode === studentCode && r.code === code));
    fs.writeFileSync(RECORDS_FILE, JSON.stringify(list, null, 2), 'utf8');
    return { status: 'success', message: 'Đã xóa bản ghi điểm danh!' };
}

async function dbSaveCheckin(record) {
    if (pool) {
        try {
            await pool.query(`
                INSERT INTO checkins (timestamp, code, title, student_code, name, class_name, faculty, phone_number, email, coords, distance, device, ip, device_uuid)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14);
            `, [
                record.timestamp || getVietnamTimestamp(),
                record.code || '', record.title || '', record.studentCode || '',
                record.name || '', record.className || '', record.faculty || '',
                record.phoneNumber || '', record.email || '', record.coords || '',
                record.distance || '', record.device || '', record.ip || '', record.deviceUuid || ''
            ]);
            return true;
        } catch (e) { console.error('Lỗi ghi checkin vào SQL:', e); }
    }
    let list = [];
    if (fs.existsSync(RECORDS_FILE)) {
        try { list = JSON.parse(fs.readFileSync(RECORDS_FILE, 'utf8')); } catch (e) {}
    }
    if (!record.timestamp) {
        record.timestamp = getVietnamTimestamp();
    }
    list.unshift(record);
    fs.writeFileSync(RECORDS_FILE, JSON.stringify(list, null, 2), 'utf8');
    return true;
}

async function dbSaveBatchCheckins(records) {
    if (!Array.isArray(records) || records.length === 0) return { status: 'error', message: 'Dữ liệu danh sách rỗng!' };
    
    if (pool) {
        try {
            for (const r of records) {
                if (!r) continue;
                await pool.query(`
                    INSERT INTO checkins (timestamp, code, title, student_code, name, class_name, faculty, phone_number, email, coords, distance, device, ip, device_uuid)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14);
                `, [
                    r.timestamp || getVietnamTimestamp(),
                    r.code || '', r.title || '', r.studentCode || '',
                    r.name || '', r.className || '', r.faculty || '',
                    r.phoneNumber || '', r.email || '', r.coords || 'Thủ công (Excel)',
                    r.distance || 'Nhập từ Excel (Admin)', r.device || 'Import Excel',
                    r.ip || '127.0.0.1', r.deviceUuid || ''
                ]);
            }
            return { status: 'success', count: records.length, message: `Đã nhập thành công ${records.length} lượt điểm danh từ Excel!` };
        } catch (e) { console.error('Lỗi batch checkin SQL:', e); }
    }
    
    let list = [];
    if (fs.existsSync(RECORDS_FILE)) {
        try { list = JSON.parse(fs.readFileSync(RECORDS_FILE, 'utf8')); } catch (e) {}
    }
    records.slice().reverse().forEach(r => {
        if (!r.timestamp) r.timestamp = getVietnamTimestamp();
        list.unshift(r);
    });
    fs.writeFileSync(RECORDS_FILE, JSON.stringify(list, null, 2), 'utf8');
    return { status: 'success', count: records.length, message: `Đã nhập ${records.length} bản ghi!` };
}

// Helpers Quản Lý Tài Khoản (Accounts)
async function dbGetAccounts() {
    if (pool) {
        try {
            const res = await pool.query('SELECT username, password, role, status, reg_date as "regDate", is_default as "isDefault" FROM accounts ORDER BY is_default DESC, reg_date ASC');
            return res.rows;
        } catch (e) { console.error('Lỗi đọc accounts từ SQL:', e); }
    }
    if (fs.existsSync(ACCOUNTS_FILE)) {
        try { return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')); } catch (e) {}
    }
    return [{ username: 'admin', password: 'admin123', role: 'super', status: 'approved', regDate: 'Mặc định hệ thống', isDefault: true }];
}

async function dbSaveAccountsLocal(list) {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

async function dbLogin(username, password) {
    const userClean = (username || '').trim().toLowerCase();
    const pwdClean = (password || '').trim();

    if (pool) {
        try {
            const res = await pool.query('SELECT username, password, role, status FROM accounts WHERE LOWER(username) = $1', [userClean]);
            if (res.rows.length === 0) {
                return { status: 'error', message: 'Tên đăng nhập / Email không tồn tại!' };
            }
            const acc = res.rows[0];
            if (acc.password !== pwdClean) {
                return { status: 'error', message: 'Mật khẩu không chính xác!' };
            }
            if (acc.status === 'pending') {
                return { status: 'error', message: 'Tài khoản của bạn đang chờ Super Admin phê duyệt!' };
            }
            return { status: 'success', role: acc.role, username: acc.username };
        } catch (e) { console.error('Lỗi login SQL:', e); }
    }

    // Fallback local
    const list = await dbGetAccounts();
    const acc = list.find(a => String(a.username || '').toLowerCase() === userClean);
    if (!acc) return { status: 'error', message: 'Tên đăng nhập không tồn tại!' };
    if (acc.password !== pwdClean) return { status: 'error', message: 'Mật khẩu không chính xác!' };
    if (acc.status === 'pending') return { status: 'error', message: 'Tài khoản đang chờ Super Admin phê duyệt!' };
    return { status: 'success', role: acc.role, username: acc.username };
}

async function dbRegister(username, password, role, adminCode) {
    const userClean = (username || '').trim().toLowerCase();
    const pwdClean = (password || '').trim();
    if (!userClean || !pwdClean) return { status: 'error', message: 'Vui lòng điền tên đăng nhập và mật khẩu!' };

    const currentAdminCode = await dbGetAdminCode();
    if (role === 'super' && adminCode !== currentAdminCode) {
        return { status: 'error', message: 'Mã Admin bảo mật không chính xác!' };
    }

    const regDate = getVietnamTimestamp();
    const status = (role === 'super') ? 'approved' : 'pending';

    if (pool) {
        try {
            const checkRes = await pool.query('SELECT username FROM accounts WHERE LOWER(username) = $1', [userClean]);
            if (checkRes.rows.length > 0) {
                return { status: 'error', message: 'Tên đăng nhập / Email này đã tồn tại!' };
            }

            await pool.query(`
                INSERT INTO accounts (username, password, role, status, reg_date, is_default)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [userClean, pwdClean, role, status, regDate, false]);

            return { status: 'success', requiresApproval: (status === 'pending'), message: 'Đăng ký thành công!' };
        } catch (e) { console.error('Lỗi register SQL:', e); }
    }

    // Fallback local
    const list = await dbGetAccounts();
    if (list.some(a => String(a.username || '').toLowerCase() === userClean)) {
        return { status: 'error', message: 'Tên đăng nhập này đã tồn tại!' };
    }
    list.push({ username: userClean, password: pwdClean, role: role, status: status, regDate: regDate, isDefault: false });
    await dbSaveAccountsLocal(list);
    return { status: 'success', requiresApproval: (status === 'pending'), message: 'Đăng ký thành công!' };
}

async function dbApproveAccount(username) {
    const uClean = (username || '').trim().toLowerCase();
    if (pool) {
        try {
            await pool.query("UPDATE accounts SET status = 'approved' WHERE LOWER(username) = $1", [uClean]);
            return { status: 'success', message: 'Đã phê duyệt tài khoản thành công!' };
        } catch (e) { console.error('Lỗi approve SQL:', e); }
    }
    const list = await dbGetAccounts();
    const acc = list.find(a => String(a.username || '').toLowerCase() === uClean);
    if (acc) {
        acc.status = 'approved';
        await dbSaveAccountsLocal(list);
    }
    return { status: 'success', message: 'Đã phê duyệt tài khoản!' };
}

async function dbDeleteAccount(username) {
    const uClean = (username || '').trim().toLowerCase();

    if (pool) {
        try {
            await pool.query("DELETE FROM accounts WHERE LOWER(username) = $1", [uClean]);
            return { status: 'success', message: 'Đã xóa tài khoản thành công!' };
        } catch (e) { console.error('Lỗi delete SQL:', e); }
    }
    let list = await dbGetAccounts();
    list = list.filter(a => String(a.username || '').toLowerCase() !== uClean);
    await dbSaveAccountsLocal(list);
    return { status: 'success', message: 'Đã xóa tài khoản!' };
}

async function dbUpdateAccount(username, password, role, status) {
    const uClean = (username || '').trim().toLowerCase();
    const pwdClean = (password || '').trim();
    const roleClean = (role || 'staff').trim();
    const statusClean = (status || 'approved').trim();

    if (!uClean) return { status: 'error', message: 'Tên đăng nhập không hợp lệ!' };

    if (pool) {
        try {
            await pool.query(
                "UPDATE accounts SET password = $1, role = $2, status = $3 WHERE LOWER(username) = $4",
                [pwdClean, roleClean, statusClean, uClean]
            );
            return { status: 'success', message: 'Đã cập nhật thông tin tài khoản thành công!' };
        } catch (e) { console.error('Lỗi update account SQL:', e); }
    }
    const list = await dbGetAccounts();
    const acc = list.find(a => String(a.username || '').toLowerCase() === uClean);
    if (acc) {
        if (pwdClean) acc.password = pwdClean;
        acc.role = roleClean;
        acc.status = statusClean;
        await dbSaveAccountsLocal(list);
    }
    return { status: 'success', message: 'Đã cập nhật tài khoản!' };
}

async function dbSendOtp(emailOrUsername) {
    const target = (emailOrUsername || '').trim().toLowerCase();
    if (!target) return { status: 'error', message: 'Vui lòng nhập Email / Tên đăng nhập!' };

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    if (pool) {
        try {
            const res = await pool.query('SELECT username FROM accounts WHERE LOWER(username) = $1 OR LOWER(username) LIKE $2', [target, `%${target}%`]);
            if (res.rows.length === 0) {
                return { status: 'error', message: 'Tên đăng nhập không tồn tại trong CSDL SQL!' };
            }
            const foundUser = res.rows[0].username;
            await pool.query('UPDATE accounts SET otp_code = $1 WHERE username = $2', [otpCode, foundUser]);
            return { status: 'success', otp: otpCode, message: 'Đã khởi tạo mã OTP xác nhận!' };
        } catch (e) { console.error('Lỗi sendOtp SQL:', e); }
    }

    const list = await dbGetAccounts();
    const acc = list.find(a => String(a.username || '').toLowerCase().includes(target));
    if (!acc) return { status: 'error', message: 'Tên đăng nhập không tồn tại!' };
    acc.otp_code = otpCode;
    await dbSaveAccountsLocal(list);
    return { status: 'success', otp: otpCode, message: 'Đã khởi tạo mã OTP!' };
}

async function dbVerifyOtp(emailOrUsername, otp) {
    const target = (emailOrUsername || '').trim().toLowerCase();
    const otpClean = (otp || '').trim();

    if (pool) {
        try {
            const res = await pool.query('SELECT username, password, otp_code FROM accounts WHERE LOWER(username) = $1 OR LOWER(username) LIKE $2', [target, `%${target}%`]);
            if (res.rows.length === 0) return { status: 'error', message: 'Tài khoản không tồn tại!' };
            const acc = res.rows[0];
            if (!acc.otp_code || acc.otp_code !== otpClean) {
                return { status: 'error', message: 'Mã OTP không chính xác!' };
            }
            return { status: 'success', password: acc.password, message: 'Xác thực OTP thành công!' };
        } catch (e) { console.error('Lỗi verifyOtp SQL:', e); }
    }

    const list = await dbGetAccounts();
    const acc = list.find(a => String(a.username || '').toLowerCase().includes(target));
    if (!acc) return { status: 'error', message: 'Tài khoản không tồn tại!' };
    if (!acc.otp_code || acc.otp_code !== otpClean) return { status: 'error', message: 'Mã OTP không chính xác!' };
    return { status: 'success', password: acc.password, message: 'Xác thực OTP thành công!' };
}

async function dbGetAdminCode() {
    if (pool) {
        try {
            const res = await pool.query("SELECT value_text FROM system_config WHERE key_name = 'adminCode'");
            if (res.rows.length > 0) return res.rows[0].value_text;
        } catch (e) {}
    }
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            return cfg.adminCode || 'admin123';
        } catch (e) {}
    }
    return 'admin123';
}

async function dbSetAdminCode(newCode) {
    if (pool) {
        try {
            await pool.query(`
                INSERT INTO system_config (key_name, value_text) VALUES ('adminCode', $1)
                ON CONFLICT (key_name) DO UPDATE SET value_text = EXCLUDED.value_text
            `, [newCode]);
            return true;
        } catch (e) { console.error('Lỗi setAdminCode SQL:', e); }
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ adminCode: newCode }, null, 2), 'utf8');
    return true;
}

const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    let pathname = parsedUrl.pathname;

    // SPA Rewrite
    if (pathname.startsWith('/Activity/CheckIn/') || pathname.startsWith('/checkin/')) {
        pathname = '/checkin.html';
    }

    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // API Routes
    if (pathname === '/api/server-info') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ localIp: getLocalIp(), port: PORT, hasDatabase: !!pool }));
        return;
    }

    if (pathname === '/api' || pathname.startsWith('/api/')) {
        const action = parsedUrl.searchParams.get('action') || '';

        if (req.method === 'GET') {
            if (action === 'getActivities' || pathname === '/api/activities') {
                const list = await dbGetActivities();
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(list));
                return;
            }

            if (action === 'saveActivities') {
                const dataStr = parsedUrl.searchParams.get('data') || '[]';
                try {
                    const parsed = JSON.parse(dataStr);
                    await dbSaveActivities(parsed);
                } catch (e) {}
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ status: 'success', message: 'Đã lưu danh sách sự kiện' }));
                return;
            }

            if (action === 'deleteActivity') {
                const code = parsedUrl.searchParams.get('code') || '';
                await dbDeleteActivity(code);
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ status: 'success', message: 'Đã xóa sự kiện' }));
                return;
            }

            if (action === 'getRecords' || pathname === '/api/records') {
                const list = await dbGetCheckins();
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(list));
                return;
            }

            if (action === 'getAccounts') {
                const list = await dbGetAccounts();
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(list));
                return;
            }

            if (action === 'approveAccount') {
                const u = parsedUrl.searchParams.get('username') || '';
                const result = await dbApproveAccount(u);
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(result));
                return;
            }

            if (action === 'deleteAccount') {
                const u = parsedUrl.searchParams.get('username') || '';
                const result = await dbDeleteAccount(u);
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(result));
                return;
            }

            if (action === 'updateAccount' || action === 'editAccount') {
                const u = parsedUrl.searchParams.get('username') || '';
                const p = parsedUrl.searchParams.get('password') || '';
                const r = parsedUrl.searchParams.get('role') || 'staff';
                const s = parsedUrl.searchParams.get('status') || 'approved';
                const result = await dbUpdateAccount(u, p, r, s);
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(result));
                return;
            }

            if (action === 'deleteCheckin' || action === 'deleteCheckinRecord') {
                const id = parsedUrl.searchParams.get('id') || '';
                const sc = parsedUrl.searchParams.get('studentCode') || '';
                const code = parsedUrl.searchParams.get('code') || '';
                const result = await dbDeleteCheckinRecord(id, sc, code);
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(result));
                return;
            }

            if (action === 'getAdminCode') {
                const code = await dbGetAdminCode();
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ status: 'success', code: code }));
                return;
            }

            if (action === 'setAdminCode') {
                const newCode = parsedUrl.searchParams.get('code') || '';
                await dbSetAdminCode(newCode);
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ status: 'success', message: 'Đã cập nhật mã Admin mới' }));
                return;
            }

            if (action === 'exportCsv' || pathname === '/api/export-csv') {
                let csv = '\uFEFFSTT,Thời Gian,Mã Sự Kiện,MSSV,Họ và Tên,Lớp,Khoa,Khoảng Cách,Thiết Bị,Tọa độ sự kiện,Số Điện Thoại,Gmail,Tên Sự Kiện,IP Máy\r\n';
                const list = await dbGetCheckins();
                list.forEach((item, idx) => {
                    const val = (k) => item[k] || '';
                    csv += `${idx + 1},"${val('timestamp')}","${val('code')}","${val('studentCode')}","${val('name')}","${val('className')}","${val('faculty')}","${val('distance')}","${val('device')}","${val('coords')}","${val('phoneNumber')}","${val('email')}","${val('title')}","${val('ip')}"\r\n`;
                });
                res.writeHead(200, {
                    'Content-Type': 'text/csv; charset=utf-8',
                    'Content-Disposition': `attachment; filename="Danh_Sach_Diem_Danh_${Date.now()}.csv"`
                });
                res.end(csv);
                return;
            }

            // Mặc định GET /api trả về danh sách bản ghi
            const list = await dbGetCheckins();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(list));
            return;
        }

        if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', async () => {
                try {
                    if (body.trim().startsWith('[')) {
                        const parsed = JSON.parse(body);
                        await dbSaveActivities(parsed);
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({ status: 'success', message: 'Đã lưu danh sách sự kiện' }));
                        return;
                    }

                    const json = JSON.parse(body);

                    if (action === 'login' || json.action === 'login') {
                        const result = await dbLogin(json.username, json.password);
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify(result));
                        return;
                    }

                    if (action === 'registerAccount' || json.action === 'registerAccount') {
                        const result = await dbRegister(json.username, json.password, json.role, json.adminCode);
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify(result));
                        return;
                    }

                    if (action === 'sendOtp' || json.action === 'sendOtp') {
                        const target = json.email || json.username || '';
                        const result = await dbSendOtp(target);
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify(result));
                        return;
                    }

                    if (action === 'verifyOtp' || json.action === 'verifyOtp') {
                        const target = json.email || json.username || '';
                        const result = await dbVerifyOtp(target, json.otp);
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify(result));
                        return;
                    }

                    if (action === 'updateAccount' || json.action === 'updateAccount' || action === 'editAccount') {
                        const result = await dbUpdateAccount(json.username, json.password, json.role, json.status);
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify(result));
                        return;
                    }

                    if (action === 'updateCheckin' || json.action === 'updateCheckin') {
                        const result = await dbUpdateCheckin(json);
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify(result));
                        return;
                    }

                    if (action === 'deleteCheckin' || json.action === 'deleteCheckin' || action === 'deleteCheckinRecord') {
                        const result = await dbDeleteCheckinRecord(json.id, json.studentCode, json.code);
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify(result));
                        return;
                    }

                    if (action === 'batchCheckin' || json.action === 'batchCheckin' || action === 'importCheckins') {
                        const list = Array.isArray(json) ? json : (json.records || []);
                        const result = await dbSaveBatchCheckins(list);
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify(result));
                        return;
                    }

                    if (action === 'deleteActivity' || json.action === 'deleteActivity') {
                        await dbDeleteActivity(json.code || json.activityCode);
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({ status: 'success', message: 'Đã xóa sự kiện' }));
                        return;
                    }

                    if (json.action === 'saveActivities') {
                        const toSave = Array.isArray(json) ? json : (json.activities || []);
                        await dbSaveActivities(toSave);
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({ status: 'success', message: 'Đã lưu danh sách sự kiện' }));
                        return;
                    }

                    // Điểm danh sinh viên
                    if (!json.timestamp) {
                        json.timestamp = getVietnamTimestamp();
                    }
                    await dbSaveCheckin(json);

                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ status: 'success', message: 'Điểm danh thành công!' }));
                } catch (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ status: 'error', message: err.toString() }));
                }
            });
            return;
        }
    }

    // File Tĩnh
    let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(__dirname, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.webmanifest': 'application/manifest+json; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon'
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';
    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    const localIp = getLocalIp();
    console.log('==================================================================');
    console.log('Web Server backend GPS Attendance (Node.js + PostgreSQL) đang chạy!');
    console.log(`- Truy cập trên máy tính: http://localhost:${PORT}`);
    console.log(`- Truy cập từ điện thoại (cung Wi-Fi): http://${localIp}:${PORT}`);
    console.log('==================================================================');
});
