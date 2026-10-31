const fs = require('fs');

const recs = JSON.parse(fs.readFileSync('default_data/records.json', 'utf8'));
const acts = JSON.parse(fs.readFileSync('default_data/activities.json', 'utf8'));

function toCsv(headers, rows, getRow) {
    const lines = [headers.join(',')];
    rows.forEach((r, idx) => {
        const vals = getRow(r, idx).map(v => {
            const str = String(v === null || v === undefined ? '' : v);
            return '"' + str.replace(/"/g, '""') + '"';
        });
        lines.push(vals.join(','));
    });
    return '\uFEFF' + lines.join('\r\n');
}

const recHeaders = ['STT', 'Thời gian điểm danh', 'Mã sự kiện', 'Tên sự kiện', 'MSSV', 'Họ và tên', 'Lớp', 'Khoa', 'Số điện thoại', 'Email', 'Tọa độ GPS', 'Khoảng cách', 'Thiết bị', 'Địa chỉ IP', 'Quyền lợi'];
const recCsv = toCsv(recHeaders, recs, (r, i) => [
    i + 1, r.timestamp || '', r.code || '', r.title || '', r.studentCode || '',
    r.name || '', r.className || '', r.faculty || '', r.phoneNumber || '',
    r.email || '', r.coords || '', r.distance || '', r.device || '', r.ip || '', r.benefit || ''
]);

fs.writeFileSync('C:/Users/DELL/Desktop/BACKUP_DIEM_DANH_MUCE/DANH_SACH_DIEM_DANH_TOAN_BO_LICH_SU.csv', recCsv, 'utf8');
fs.writeFileSync('C:/Users/DELL/Desktop/BACKUP_DIEM_DANH_MUCE/DANH_SACH_DIEM_DANH_MOI_NHAT_1323_SV.csv', recCsv, 'utf8');

const actHeaders = ['STT', 'Mã sự kiện', 'Tên sự kiện', 'Mô tả', 'Địa chỉ', 'Kinh độ', 'Vĩ độ', 'Bán kính (m)', 'Bắt đầu', 'Kết thúc', 'Quyền lợi', 'Người tạo'];
const actCsv = toCsv(actHeaders, acts, (a, i) => [
    i + 1, a.code || '', a.title || '', a.description || '', a.locationAddress || '',
    a.longitude || '', a.latitude || '', a.radiusMeters || '', a.startTime || '', a.endTime || '',
    a.benefit || '', a.createdBy || ''
]);

fs.writeFileSync('C:/Users/DELL/Desktop/BACKUP_DIEM_DANH_MUCE/DANH_SACH_SU_KIEN_TOAN_BO.csv', actCsv, 'utf8');
fs.writeFileSync('C:/Users/DELL/Desktop/BACKUP_DIEM_DANH_MUCE/DANH_SACH_SU_KIEN_MOI_NHAT_52_SK.csv', actCsv, 'utf8');

console.log('✅ Đã tạo xong toàn bộ file CSV mới nhất với 1.323 sinh viên và 52 sự kiện!');
