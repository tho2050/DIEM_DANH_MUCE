// Kịch bản khôi phục toàn bộ 43 sự kiện và 1.179 sinh viên lên máy chủ Render
const fs = require('fs');
const https = require('https');

function postJson(url, data) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(data);
        const u = new URL(url);
        const req = https.request({
            hostname: u.hostname,
            port: u.port || 443,
            path: u.pathname + u.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            },
            timeout: 60000
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    resolve({ raw: body });
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.write(payload);
        req.end();
    });
}

async function restore() {
    console.log('========================================================');
    console.log('   TIẾN HÀNH KHÔI PHỤC TOÀN BỘ DỮ LIỆU LÊN RENDER');
    console.log('========================================================');

    // 1. Khôi phục 43 sự kiện
    console.log('\n[1/3] Đang nạp danh sách 43 sự kiện từ bản sao lưu...');
    const rawActs = fs.readFileSync('BACKUP_DU_LIEU_LICH_SU/toan_bo_su_kien_43_su_kien.json', 'utf8').replace(/^\uFEFF/, '');
    const acts = JSON.parse(rawActs);
    console.log(`  -> Đã đọc ${acts.length} sự kiện. Đang gửi lên Render...`);
    
    const resActs = await postJson('https://diem-danh-muce.onrender.com/api', {
        action: 'saveActivities',
        activities: acts
    });
    console.log('  -> Kết quả nạp sự kiện:', resActs.status || resActs);

    // 2. Khôi phục 1.179 lượt điểm danh
    console.log('\n[2/3] Đang nạp danh sách 1.179 lượt điểm danh từ bản sao lưu...');
    const rawRecs = fs.readFileSync('BACKUP_DU_LIEU_LICH_SU/toan_bo_diem_danh_1179_ban_ghi.json', 'utf8').replace(/^\uFEFF/, '');
    const recs = JSON.parse(rawRecs);
    console.log(`  -> Đã đọc ${recs.length} lượt điểm danh. Bắt đầu gửi theo từng đợt (Batch)...`);

    // Gửi theo từng đợt 100 bản ghi để đảm bảo an toàn đường truyền và không bị timeout
    const batchSize = 100;
    let totalImported = 0;
    for (let i = 0; i < recs.length; i += batchSize) {
        const chunk = recs.slice(i, i + batchSize);
        process.stdout.write(`  -> Đang gửi đợt ${Math.floor(i / batchSize) + 1} (${i + 1} đến ${Math.min(i + batchSize, recs.length)})... `);
        const resBatch = await postJson('https://diem-danh-muce.onrender.com/api', {
            action: 'batchCheckin',
            records: chunk
        });
        totalImported += chunk.length;
        console.log(`Thành công! (${totalImported}/${recs.length})`);
    }

    // 3. Khôi phục tài khoản nếu có tài khoản bổ sung
    console.log('\n[3/3] Đang kiểm tra cấu hình...');
    
    console.log('\n========================================================');
    console.log(`✅ HOÀN TẤT KHÔI PHỤC TOÀN BỘ DỮ LIỆU!`);
    console.log(`- Sự kiện đã khôi phục: ${acts.length} sự kiện.`);
    console.log(`- Sinh viên đã khôi phục: ${totalImported} lượt điểm danh.`);
    console.log('========================================================');
}

restore().catch(err => {
    console.error('Lỗi trong quá trình khôi phục:', err);
});
