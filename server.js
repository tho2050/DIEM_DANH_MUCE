process.env.TZ = 'Asia/Ho_Chi_Minh';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Pool } = require('pg');

let nodemailer = null;
try {
    nodemailer = require('nodemailer');
} catch (e) {
    console.warn('⚠️ Gói nodemailer chưa nạp được:', e.message);
}

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
const DELETED_ACTIVITIES_FILE = path.join(DATA_DIR, 'deleted_activities.json');
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_deleted BOOLEAN DEFAULT FALSE,
            deleted_at TEXT,
            created_by TEXT
        );

        -- Tự động thêm cột created_by nếu bảng đã tạo từ trước
        DO $$ 
        BEGIN 
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activities' AND column_name='created_by') THEN
                ALTER TABLE activities ADD COLUMN created_by TEXT;
            END IF;
        END $$;

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

            try {
                await pool.query(`
                    ALTER TABLE activities ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
                    ALTER TABLE activities ADD COLUMN IF NOT EXISTS deleted_at TEXT;
                `);
            } catch (e) {
                console.error("Lỗi cập nhật cột is_deleted cho activities:", e);
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
            const res = await pool.query('SELECT code, title, description, location_address as "locationAddress", latitude, longitude, radius_meters as "radiusMeters", start_time as "startTime", end_time as "endTime", COALESCE(NULLIF(created_by, \'\'), \'hongnhung\') as "createdBy" FROM activities WHERE is_deleted IS NOT TRUE ORDER BY created_at DESC');
            return res.rows;
        } catch (e) { console.error('Lỗi đọc activities từ SQL:', e); }
    }
    if (fs.existsSync(ACTIVITIES_FILE)) {
        try { 
            const list = JSON.parse(fs.readFileSync(ACTIVITIES_FILE, 'utf8'));
            if (Array.isArray(list)) return list.map(a => ({ ...a, createdBy: a.createdBy || 'hongnhung' }));
        } catch (e) {}
    }
    return [];
}

async function dbGetDeletedActivities() {
    if (pool) {
        try {
            const res = await pool.query('SELECT code, title, description, location_address as "locationAddress", latitude, longitude, radius_meters as "radiusMeters", start_time as "startTime", end_time as "endTime", COALESCE(NULLIF(created_by, \'\'), \'hongnhung\') as "createdBy", deleted_at as "deletedAt" FROM activities WHERE is_deleted = TRUE ORDER BY deleted_at DESC');
            return res.rows;
        } catch (e) { console.error('Lỗi đọc deleted activities từ SQL:', e); }
    }
    if (fs.existsSync(DELETED_ACTIVITIES_FILE)) {
        try { 
            const list = JSON.parse(fs.readFileSync(DELETED_ACTIVITIES_FILE, 'utf8'));
            if (Array.isArray(list)) return list.map(a => ({ ...a, createdBy: a.createdBy || 'hongnhung' }));
        } catch (e) {}
    }
    return [];
}

async function dbSaveActivities(activitiesList) {
    if (pool) {
        try {
            const validCodes = (activitiesList || []).map(a => a ? a.code : null).filter(Boolean);
            if (validCodes.length > 0) {
                // Đánh dấu is_deleted = TRUE cho các sự kiện không còn trong danh sách (để có thể khôi phục)
                await pool.query(
                    'UPDATE activities SET is_deleted = TRUE, deleted_at = $1 WHERE (is_deleted IS NOT TRUE) AND code NOT IN (' + validCodes.map((_, i) => '$' + (i + 2)).join(',') + ')',
                    [getVietnamTimestamp(), ...validCodes]
                );
            }

            for (const act of activitiesList) {
                if (!act || !act.code) continue;
                await pool.query(`
                    INSERT INTO activities (code, title, description, location_address, latitude, longitude, radius_meters, start_time, end_time, created_by, is_deleted, deleted_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE, NULL)
                    ON CONFLICT (code) DO UPDATE SET
                        title = EXCLUDED.title,
                        description = EXCLUDED.description,
                        location_address = EXCLUDED.location_address,
                        latitude = EXCLUDED.latitude,
                        longitude = EXCLUDED.longitude,
                        radius_meters = EXCLUDED.radius_meters,
                        start_time = EXCLUDED.start_time,
                        end_time = EXCLUDED.end_time,
                        created_by = COALESCE(NULLIF(EXCLUDED.created_by, ''), activities.created_by),
                        is_deleted = FALSE,
                        deleted_at = NULL;
                `, [
                    act.code, act.title || '', act.description || '', act.locationAddress || '',
                    parseFloat(act.latitude) || 0, parseFloat(act.longitude) || 0,
                    parseInt(act.radiusMeters) || 50, act.startTime || '', act.endTime || '',
                    act.createdBy || 'hongnhung'
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
    const delTime = getVietnamTimestamp();
    if (pool) {
        try {
            await pool.query('UPDATE activities SET is_deleted = TRUE, deleted_at = $1 WHERE code = $2', [delTime, code]);
            return true;
        } catch (e) { console.error('Lỗi soft delete activity SQL:', e); }
    }
    let act = null;
    if (fs.existsSync(ACTIVITIES_FILE)) {
        try {
            let list = JSON.parse(fs.readFileSync(ACTIVITIES_FILE, 'utf8'));
            act = list.find(a => a.code === code);
            list = list.filter(a => a.code !== code);
            fs.writeFileSync(ACTIVITIES_FILE, JSON.stringify(list, null, 2), 'utf8');
        } catch (e) {}
    }
    if (act) {
        let delList = [];
        if (fs.existsSync(DELETED_ACTIVITIES_FILE)) {
            try { delList = JSON.parse(fs.readFileSync(DELETED_ACTIVITIES_FILE, 'utf8')); } catch (e) {}
        }
        delList = delList.filter(a => a.code !== code);
        delList.unshift({ ...act, deletedAt: delTime });
        fs.writeFileSync(DELETED_ACTIVITIES_FILE, JSON.stringify(delList, null, 2), 'utf8');
    }
    return true;
}

async function dbRestoreActivity(code) {
    if (!code) return true;
    if (pool) {
        try {
            await pool.query('UPDATE activities SET is_deleted = FALSE, deleted_at = NULL WHERE code = $1', [code]);
            return true;
        } catch (e) { console.error('Lỗi restore activity SQL:', e); }
    }
    let restoredAct = null;
    if (fs.existsSync(DELETED_ACTIVITIES_FILE)) {
        try {
            let delList = JSON.parse(fs.readFileSync(DELETED_ACTIVITIES_FILE, 'utf8'));
            restoredAct = delList.find(a => a.code === code);
            delList = delList.filter(a => a.code !== code);
            fs.writeFileSync(DELETED_ACTIVITIES_FILE, JSON.stringify(delList, null, 2), 'utf8');
        } catch (e) {}
    }
    if (restoredAct) {
        let list = [];
        if (fs.existsSync(ACTIVITIES_FILE)) {
            try { list = JSON.parse(fs.readFileSync(ACTIVITIES_FILE, 'utf8')); } catch (e) {}
        }
        delete restoredAct.deletedAt;
        list = list.filter(a => a.code !== code);
        list.unshift(restoredAct);
        fs.writeFileSync(ACTIVITIES_FILE, JSON.stringify(list, null, 2), 'utf8');
    }
    return true;
}

async function dbPermanentDeleteActivity(code) {
    if (!code) return true;
    if (pool) {
        try {
            await pool.query('DELETE FROM activities WHERE code = $1', [code]);
            return true;
        } catch (e) { console.error('Lỗi permanent delete activity SQL:', e); }
    }
    if (fs.existsSync(DELETED_ACTIVITIES_FILE)) {
        try {
            let delList = JSON.parse(fs.readFileSync(DELETED_ACTIVITIES_FILE, 'utf8'));
            delList = delList.filter(a => a.code !== code);
            fs.writeFileSync(DELETED_ACTIVITIES_FILE, JSON.stringify(delList, null, 2), 'utf8');
        } catch (e) {}
    }
    return true;
}

async function dbEmptyTrashActivities() {
    if (pool) {
        try {
            await pool.query('DELETE FROM activities WHERE is_deleted = TRUE');
            return true;
        } catch (e) { console.error('Lỗi empty trash SQL:', e); }
    }
    fs.writeFileSync(DELETED_ACTIVITIES_FILE, JSON.stringify([], null, 2), 'utf8');
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

// Cấu hình SMTP gửi mail Gmail thực tế
async function dbGetSmtpConfig() {
    let host = process.env.SMTP_HOST || 'smtp.gmail.com';
    let port = parseInt(process.env.SMTP_PORT) || 465;
    let user = process.env.GMAIL_USER || process.env.SMTP_USER || '';
    let pass = process.env.GMAIL_PASS || process.env.SMTP_PASS || '';

    if (pool) {
        try {
            const res = await pool.query("SELECT value_text FROM system_config WHERE key_name = 'smtp_config'");
            if (res.rows.length > 0 && res.rows[0].value_text) {
                const parsed = JSON.parse(res.rows[0].value_text);
                if (parsed.user) user = parsed.user;
                if (parsed.pass) pass = parsed.pass;
                if (parsed.host) host = parsed.host;
                if (parsed.port) port = parseInt(parsed.port) || 465;
            }
        } catch (e) {}
    }
    if ((!user || !pass) && fs.existsSync(CONFIG_FILE)) {
        try {
            const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            if (cfg.smtp) {
                if (cfg.smtp.user) user = cfg.smtp.user;
                if (cfg.smtp.pass) pass = cfg.smtp.pass;
                if (cfg.smtp.host) host = cfg.smtp.host;
                if (cfg.smtp.port) port = parseInt(cfg.smtp.port) || 465;
            }
        } catch (e) {}
    }
    return { host, port, user, pass };
}

async function dbSaveSmtpConfig(user, pass, host = 'smtp.gmail.com', port = 465) {
    const configData = JSON.stringify({ user: (user || '').trim(), pass: (pass || '').trim().replace(/\s+/g, ''), host, port });
    if (pool) {
        try {
            await pool.query(`
                INSERT INTO system_config (key_name, value_text) VALUES ('smtp_config', $1)
                ON CONFLICT (key_name) DO UPDATE SET value_text = EXCLUDED.value_text
            `, [configData]);
        } catch (e) { console.error('Lỗi lưu smtp_config SQL:', e); }
    }
    try {
        let cur = {};
        if (fs.existsSync(CONFIG_FILE)) {
            try { cur = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) {}
        }
        cur.smtp = { user: (user || '').trim(), pass: (pass || '').trim().replace(/\s+/g, ''), host, port };
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(cur, null, 2), 'utf8');
    } catch (e) {}
    return { status: 'success', message: 'Đã lưu cấu hình gửi Gmail SMTP thành công!' };
}

async function sendRealOtpEmail(recipientEmail, otpCode, username) {
    if (!nodemailer) {
        return { sent: false, needConfig: true, reason: 'Chưa cài đặt thư viện nodemailer' };
    }
    const { host, port, user, pass } = await dbGetSmtpConfig();
    if (!user || !pass) {
        return { sent: false, needConfig: true, reason: 'Chưa thiết lập tài khoản Gmail gửi mã (App Password)' };
    }

    try {
        const transporter = nodemailer.createTransport({
            host: host,
            port: port,
            secure: port === 465,
            auth: { user, pass },
            tls: { rejectUnauthorized: false }
        });

        const mailOptions = {
            from: `"Điểm Danh GPS MUCE" <${user}>`,
            to: recipientEmail,
            subject: `[MUCE] Mã OTP khôi phục mật khẩu tài khoản: ${otpCode}`,
            html: `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06);">
                    <div style="background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); padding: 24px 20px; text-align: center; color: #ffffff;">
                        <h2 style="margin: 0; font-size: 20px; font-weight: 700;">HỆ THỐNG ĐIỂM DANH GPS - MUCE</h2>
                        <p style="margin: 6px 0 0; opacity: 0.9; font-size: 13px;">Xác thực khôi phục mật khẩu tài khoản</p>
                    </div>
                    <div style="padding: 28px 24px;">
                        <p style="font-size: 15px; color: #1e293b; margin: 0 0 12px;">Xin chào <strong>${username || recipientEmail}</strong>,</p>
                        <p style="font-size: 14px; color: #475569; line-height: 1.6; margin: 0 0 20px;">
                            Bạn vừa yêu cầu mã xác nhận để lấy lại mật khẩu trên hệ thống Điểm Danh GPS. Vui lòng sử dụng mã OTP 6 chữ số dưới đây:
                        </p>
                        <div style="text-align: center; margin: 24px 0;">
                            <div style="display: inline-block; background: #f0f9ff; border: 2px dashed #0284c7; border-radius: 12px; padding: 14px 32px;">
                                <div style="font-size: 11px; font-weight: 700; color: #0369a1; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">MÃ OTP XÁC THỰC</div>
                                <span style="font-family: monospace; font-size: 36px; font-weight: 800; color: #0284c7; letter-spacing: 8px;">${otpCode}</span>
                            </div>
                        </div>
                        <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 12px 16px; border-radius: 6px; margin-bottom: 20px;">
                            <p style="margin: 0; font-size: 13px; color: #991b1b; line-height: 1.5;">
                                ⚠️ <strong>Lưu ý:</strong> Mã xác thực có hiệu lực trong <strong>10 phút</strong>. Tuyệt đối không cung cấp mã này cho người khác.
                            </p>
                        </div>
                        <p style="font-size: 13px; color: #64748b; margin: 0;">
                            Nếu không phải bạn gửi yêu cầu, vui lòng bỏ qua email này.
                        </p>
                    </div>
                    <div style="background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 14px 20px; text-align: center; font-size: 12px; color: #94a3b8;">
                        <p style="margin: 0;">Trường Đại học Xây dựng Miền Trung (MUCE)</p>
                    </div>
                </div>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ Đã gửi email OTP tới ${recipientEmail}:`, info.messageId);
        return { sent: true, messageId: info.messageId };
    } catch (err) {
        console.error('❌ Lỗi gửi email SMTP:', err);
        return { sent: false, error: err.message };
    }
}

async function dbSendOtp(emailOrUsername) {
    const target = (emailOrUsername || '').trim().toLowerCase();
    if (!target) return { status: 'error', message: 'Vui lòng nhập Email / Tên đăng nhập!' };

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    let foundUser = target;
    let recipientEmail = target;

    if (pool) {
        try {
            const res = await pool.query('SELECT username, password FROM accounts WHERE LOWER(username) = $1 OR LOWER(username) LIKE $2', [target, `%${target}%`]);
            if (res.rows.length === 0) {
                if (target === 'hongnhung2050py@gmail.com' || target === 'dhxdmtmuce') {
                    foundUser = target;
                    recipientEmail = target;
                } else {
                    return { status: 'error', message: 'Tài khoản hoặc Email này không tồn tại trong hệ thống!' };
                }
            } else {
                foundUser = res.rows[0].username;
                recipientEmail = foundUser.includes('@') ? foundUser : (target.includes('@') ? target : foundUser + '@gmail.com');
            }
            await pool.query('UPDATE accounts SET otp_code = $1 WHERE LOWER(username) = $2', [otpCode, foundUser.toLowerCase()]);
        } catch (e) {
            console.error('Lỗi sendOtp SQL:', e);
        }
    } else {
        const list = await dbGetAccounts();
        const acc = list.find(a => String(a.username || '').toLowerCase() === target || String(a.username || '').toLowerCase().includes(target));
        if (!acc) {
            if (target === 'hongnhung2050py@gmail.com' || target === 'dhxdmtmuce') {
                foundUser = target;
                recipientEmail = target;
            } else {
                return { status: 'error', message: 'Tài khoản hoặc Email này không tồn tại trong hệ thống!' };
            }
        } else {
            foundUser = acc.username;
            recipientEmail = foundUser.includes('@') ? foundUser : (target.includes('@') ? target : foundUser + '@gmail.com');
            acc.otp_code = otpCode;
            await dbSaveAccountsLocal(list);
        }
    }

    // Gửi email thật tới Gmail của người đăng ký
    const mailResult = await sendRealOtpEmail(recipientEmail, otpCode, foundUser);

    if (mailResult.sent) {
        return {
            status: 'success',
            sentViaEmail: true,
            email: recipientEmail,
            message: `Mã OTP đã được gửi trực tiếp tới hòm thư Gmail: ${recipientEmail}. Vui lòng kiểm tra hộp thư đến (Inbox) hoặc thư rác (Spam)!`
        };
    } else {
        return {
            status: 'success',
            sentViaEmail: false,
            needConfig: mailResult.needConfig,
            otp: otpCode,
            email: recipientEmail,
            message: mailResult.needConfig
                ? `Đã tạo mã OTP cho tài khoản ${recipientEmail}. (Hệ thống chưa cài đặt mật khẩu ứng dụng Gmail SMTP nên tạm cung cấp mã: ${otpCode})`
                : `Không thể kết nối máy chủ gửi mail (${mailResult.error || 'Lỗi SMTP'}). Mã OTP: ${otpCode}`
        };
    }
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
    const acc = list.find(a => String(a.username || '').toLowerCase() === target || String(a.username || '').toLowerCase().includes(target));
    if (!acc) return { status: 'error', message: 'Tài khoản không tồn tại!' };
    if (!acc.otp_code || acc.otp_code !== otpClean) return { status: 'error', message: 'Mã OTP không chính xác!' };
    return { status: 'success', password: acc.password, message: 'Xác thực OTP thành công!' };
}

// Xử lý đăng nhập / đăng ký qua tài khoản Google (OAuth)
async function dbGoogleAuth(email, name, picture, googleId) {
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || (!cleanEmail.includes('@gmail.com') && !cleanEmail.includes('@muce.edu.vn') && !cleanEmail.includes('@'))) {
        return { status: 'error', message: 'Vui lòng sử dụng địa chỉ Gmail hợp lệ (@gmail.com hoặc @muce.edu.vn)!' };
    }

    const superUsers = ["hongnhung2050py@gmail.com", "hongnhung@muce.edu.vn", "dhxdmtmuce"];
    const isSuper = superUsers.includes(cleanEmail);
    const role = isSuper ? 'super' : 'staff';
    const status = 'approved';

    if (pool) {
        try {
            const check = await pool.query('SELECT username, role, status FROM accounts WHERE LOWER(username) = $1', [cleanEmail]);
            if (check.rows.length > 0) {
                const acc = check.rows[0];
                return {
                    status: 'success',
                    username: acc.username,
                    role: isSuper ? 'super' : acc.role,
                    message: 'Đăng nhập bằng tài khoản Google thành công!'
                };
            }

            // Đăng ký tự động tài khoản Google
            const regDate = getVietnamTimestamp();
            await pool.query(`
                INSERT INTO accounts (username, password, role, status, reg_date, is_default)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [cleanEmail, 'google_sso_' + Date.now(), role, status, regDate, false]);

            return {
                status: 'success',
                username: cleanEmail,
                role: role,
                isNewUser: true,
                message: 'Đăng ký tài khoản Google mới và đăng nhập thành công!'
            };
        } catch (e) {
            console.error('Lỗi dbGoogleAuth SQL:', e);
        }
    }

    const list = await dbGetAccounts();
    let acc = list.find(a => String(a.username || '').toLowerCase() === cleanEmail);
    if (!acc) {
        acc = {
            username: cleanEmail,
            password: 'google_sso_' + Date.now(),
            role: role,
            status: status,
            regDate: getVietnamTimestamp(),
            isDefault: false
        };
        list.push(acc);
        await dbSaveAccountsLocal(list);
    }
    return {
        status: 'success',
        username: acc.username,
        role: isSuper ? 'super' : acc.role,
        message: 'Đăng nhập Google thành công!'
    };
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
                res.end(JSON.stringify({ status: 'success', message: 'Đã chuyển sự kiện vào thùng rác' }));
                return;
            }

            if (action === 'getDeletedActivities') {
                const list = await dbGetDeletedActivities();
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(list));
                return;
            }

            if (action === 'restoreActivity') {
                const code = parsedUrl.searchParams.get('code') || '';
                await dbRestoreActivity(code);
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ status: 'success', message: 'Đã khôi phục sự kiện thành công!' }));
                return;
            }

            if (action === 'permanentDeleteActivity') {
                const code = parsedUrl.searchParams.get('code') || '';
                await dbPermanentDeleteActivity(code);
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ status: 'success', message: 'Đã xóa vĩnh viễn sự kiện!' }));
                return;
            }

            if (action === 'emptyTrashActivities') {
                await dbEmptyTrashActivities();
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ status: 'success', message: 'Đã dọn sạch thùng rác sự kiện!' }));
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

                    if (action === 'googleAuth' || json.action === 'googleAuth' || action === 'googleLogin' || json.action === 'googleLogin') {
                        const result = await dbGoogleAuth(json.email, json.name, json.picture, json.googleId);
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify(result));
                        return;
                    }

                    if (action === 'saveSmtpConfig' || json.action === 'saveSmtpConfig') {
                        const result = await dbSaveSmtpConfig(json.user, json.pass, json.host, json.port);
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify(result));
                        return;
                    }

                    if (action === 'getSmtpConfig' || json.action === 'getSmtpConfig') {
                        const cfg = await dbGetSmtpConfig();
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({
                            status: 'success',
                            user: cfg.user,
                            host: cfg.host,
                            port: cfg.port,
                            hasPass: !!cfg.pass
                        }));
                        return;
                    }

                    if (action === 'testSmtp' || json.action === 'testSmtp') {
                        const target = json.email || '';
                        const testOtp = Math.floor(100000 + Math.random() * 900000).toString();
                        const result = await sendRealOtpEmail(target, testOtp, 'Admin Test');
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({
                            status: result.sent ? 'success' : 'error',
                            message: result.sent ? `Đã gửi email thử nghiệm thành công tới ${target}!` : `Gửi email thất bại: ${result.error || result.reason}`
                        }));
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
