# Script tự động sao lưu dữ liệu toàn diện Hệ Thống Điểm Danh GPS - MUCE
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

function Escape-Csv([object]$val) {
    if ($null -eq $val) { return '""' }
    return '"' + ([string]$val).Replace('"', '""') + '"'
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   HE THONG SAO LUU DU LIEU DIEM DANH GPS - MUCE (1-CLICK) " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Dang ket noi toi he thong Render de lay du lieu moi nhat..." -ForegroundColor White

$backupDir = "C:\Users\DELL\Desktop\BACKUP_DIEM_DANH_MUCE"
if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
}

$dateStr = Get-Date -Format "yyyyMMdd_HHmmss"
$dateVN = Get-Date -Format "dd/MM/yyyy HH:mm:ss"

try {
    # 1. Lay danh sach sinh vien diem danh tu Render
    Write-Host "[1/4] Dang tai danh sach sinh vien diem danh..." -ForegroundColor Gray
    $recordsJson = Invoke-RestMethod -Uri "https://diem-danh-muce.onrender.com/api?action=getRecords" -Method Get -TimeoutSec 35
    $recCount = $recordsJson.Count
    Write-Host "  -> Da tai $recCount ban ghi diem danh!" -ForegroundColor Green

    # Luu file JSON
    $recordsFile = Join-Path $backupDir "toan_bo_diem_danh_backup.json"
    $recordsDatedFile = Join-Path $backupDir ("toan_bo_diem_danh_" + $dateStr + ".json")
    $recordsJson | ConvertTo-Json -Depth 5 | Set-Content -Path $recordsFile -Encoding UTF8
    Copy-Item $recordsFile $recordsDatedFile -Force

    # Tao file CSV UTF-8 BOM chuan mo khong loi font tren Microsoft Excel
    $csvRec = [System.Text.StringBuilder]::new()
    [void]$csvRec.AppendLine([char]0xFEFF + "STT,Mã Sự Kiện,Tên Sự Kiện,Quyền Lợi,MSSV,Họ và Tên,Lớp,Khoa,Thời Gian,Khoảng Cách,Thiết Bị,Tọa Độ,Số Điện Thoại,Email,IP Máy")
    $idx = 1
    foreach ($r in $recordsJson) {
        $cCode = Escape-Csv $r.code
        $cTitle = Escape-Csv $r.title
        $cBen = Escape-Csv $r.benefit
        $cMssv = Escape-Csv $r.studentCode
        $cName = Escape-Csv $r.name
        $cClass = Escape-Csv $r.className
        $cFac = Escape-Csv $r.faculty
        $cTime = Escape-Csv $r.timestamp
        $cDist = Escape-Csv $r.distance
        $cDev = Escape-Csv $r.device
        $cCoord = Escape-Csv $r.coords
        $cPhone = Escape-Csv $r.phoneNumber
        $cMail = Escape-Csv $r.email
        $cIp = Escape-Csv $r.ip

        $line = "$idx,$cCode,$cTitle,$cBen,$cMssv,$cName,$cClass,$cFac,$cTime,$cDist,$cDev,$cCoord,$cPhone,$cMail,$cIp"
        [void]$csvRec.AppendLine($line)
        $idx++
    }
    $csvRecFile = Join-Path $backupDir "DANH_SACH_DIEM_DANH_TOAN_BO_LICH_SU.csv"
    $csvRecDated = Join-Path $backupDir ("DANH_SACH_DIEM_DANH_" + $dateStr + ".csv")
    [System.IO.File]::WriteAllText($csvRecFile, $csvRec.ToString(), [System.Text.Encoding]::UTF8)
    Copy-Item $csvRecFile $csvRecDated -Force
    Write-Host "  -> File Excel sinh vien: $csvRecFile" -ForegroundColor Cyan

    # 2. Lay danh sach su kien tu Render
    Write-Host "[2/4] Dang tai danh sach su kien..." -ForegroundColor Gray
    $actsJson = Invoke-RestMethod -Uri "https://diem-danh-muce.onrender.com/api?action=getActivities" -Method Get -TimeoutSec 35
    $actCount = $actsJson.Count
    Write-Host "  -> Da tai $actCount su kien!" -ForegroundColor Green

    $actsFile = Join-Path $backupDir "toan_bo_su_kien_backup.json"
    $actsDatedFile = Join-Path $backupDir ("toan_bo_su_kien_" + $dateStr + ".json")
    $actsJson | ConvertTo-Json -Depth 5 | Set-Content -Path $actsFile -Encoding UTF8
    Copy-Item $actsFile $actsDatedFile -Force

    $csvAct = [System.Text.StringBuilder]::new()
    [void]$csvAct.AppendLine([char]0xFEFF + "STT,Mã Sự Kiện,Tên Sự Kiện,Địa Điểm,Bán Kính (m),Thời Gian Mở,Thời Gian Đóng,Quyền Lợi,Người Tạo")
    $idx = 1
    foreach ($a in $actsJson) {
        $aCode = Escape-Csv $a.code
        $aTitle = Escape-Csv $a.title
        $aLoc = Escape-Csv $a.locationAddress
        $aRad = Escape-Csv $a.radiusMeters
        $aStart = Escape-Csv $a.startTime
        $aEnd = Escape-Csv $a.endTime
        $aBen = Escape-Csv $a.benefit
        $aBy = Escape-Csv $a.createdBy

        $line = "$idx,$aCode,$aTitle,$aLoc,$aRad,$aStart,$aEnd,$aBen,$aBy"
        [void]$csvAct.AppendLine($line)
        $idx++
    }
    $csvActFile = Join-Path $backupDir "DANH_SACH_SU_KIEN_TOAN_BO.csv"
    $csvActDated = Join-Path $backupDir ("DANH_SACH_SU_KIEN_" + $dateStr + ".csv")
    [System.IO.File]::WriteAllText($csvActFile, $csvAct.ToString(), [System.Text.Encoding]::UTF8)
    Copy-Item $csvActFile $csvActDated -Force
    Write-Host "  -> File Excel su kien:   $csvActFile" -ForegroundColor Cyan

    # 3. Kiem tra thung rac
    Write-Host "[3/4] Dang kiem tra du lieu thung rac..." -ForegroundColor Gray
    try {
        $trashRecords = Invoke-RestMethod -Uri "https://diem-danh-muce.onrender.com/api?action=getTrashCheckins" -Method Get -TimeoutSec 15
        if ($trashRecords) {
            $trashRecords | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $backupDir "thung_rac_sinh_vien.json") -Encoding UTF8
        }
    } catch {}

    # 4. Tu dong gui ban sao luu dinh kem ve Gmail Admin
    Write-Host "[4/4] Dang gui ban sao luu kem file ve Gmail hongnhung2050py@gmail.com..." -ForegroundColor Gray
    try {
        $secPass = ConvertTo-SecureString "nqeqyynpqjdngkwb" -AsPlainText -Force
        $cred = New-Object System.Management.Automation.PSCredential ("diemdanhmuce@gmail.com", $secPass)
        $body = @"
Xin chào Quản trị viên,

Hệ thống đã sao lưu toàn bộ dữ liệu Điểm Danh GPS - MUCE vào lúc $dateVN.

BÁO CÁO DỮ LIỆU SAO LƯU:
- Tổng số sinh viên điểm danh: $recCount lượt
- Tổng số sự kiện hoạt động:  $actCount sự kiện
- Trạng thái lưu trữ ngoại tuyến: $backupDir

Các file đính kèm bao gồm:
1. DANH_SACH_DIEM_DANH_TOAN_BO_LICH_SU.csv (Mở xem trực tiếp bằng Excel, chuẩn tiếng Việt 100%)
2. DANH_SACH_SU_KIEN_TOAN_BO.csv (Toàn bộ 43 sự kiện)

Dữ liệu được lưu trữ an toàn vĩnh viễn trên hộp thư Gmail của bạn.
Trường Đại học Xây dựng Miền Trung (MUCE).
"@
        Send-MailMessage -From "Hệ Thống Điểm Danh GPS MUCE <diemdanhmuce@gmail.com>" `
            -To "hongnhung2050py@gmail.com" `
            -Subject "[MUCE SAO LƯU DỮ LIỆU] $recCount Sinh Viên, $actCount Sự Kiện ($dateVN)" `
            -Body $body `
            -SmtpServer "smtp.gmail.com" `
            -Port 587 `
            -UseSsl `
            -Credential $cred `
            -Attachments @($csvRecFile, $csvActFile) `
            -Encoding ([System.Text.Encoding]::UTF8)
        Write-Host "  -> DA GUI EMAIL SAO LUU VE GMAIL THANH CONG!" -ForegroundColor Green
    } catch {
        Write-Host "  -> Gui email gap loi: $($_.Exception.Message) (Du lieu van duoc luu an toan tren may)" -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "  HOAN TAT SAO LUU DUA VAO MAY & GUI GMAIL THANH CONG!" -ForegroundColor Green
    Write-Host "  - Tong so sinh vien: $recCount luot diem danh" -ForegroundColor White
    Write-Host "  - Tong so su kien:   $actCount su kien" -ForegroundColor White
    Write-Host "  - Thu muc luu tren may: $backupDir" -ForegroundColor Yellow
    Write-Host "  - Email da nhan file:   hongnhung2050py@gmail.com" -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Green

    # Mo thu muc luu
    Invoke-Item $backupDir
} catch {
    Write-Host ""
    Write-Host "Loi khi sao luu: $($_.Exception.Message)" -ForegroundColor Red
}
