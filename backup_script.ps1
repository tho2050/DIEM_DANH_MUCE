# Script tu dong sao luu toan bo du lieu Diem Danh GPS MUCE
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

function Escape-Csv([object]$val) {
    if ($null -eq $val) { return '""' }
    return '"' + ([string]$val).Replace('"', '""') + '"'
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   HE THONG SAO LUU DU LIEU DIEM DANH GPS - MUCE         " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Dang ket noi toi he thong Render de lay du lieu moi nhat..." -ForegroundColor White

$backupDir = "C:\Users\DELL\Desktop\BACKUP_DIEM_DANH_MUCE"
if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
}

$dateStr = Get-Date -Format "yyyyMMdd_HHmmss"

try {
    # 1. Lay danh sach diem danh
    Write-Host "[1/3] Dang tai danh sach sinh vien diem danh..." -ForegroundColor Gray
    $recordsJson = Invoke-RestMethod -Uri "https://diem-danh-muce.onrender.com/api?action=getRecords" -Method Get -TimeoutSec 30
    $recCount = $recordsJson.Count
    Write-Host "  -> Da tai $recCount ban ghi diem danh!" -ForegroundColor Green

    # Luu JSON
    $recordsFile = Join-Path $backupDir "toan_bo_diem_danh_backup.json"
    $recordsDatedFile = Join-Path $backupDir ("toan_bo_diem_danh_" + $dateStr + ".json")
    $recordsJson | ConvertTo-Json -Depth 5 | Set-Content -Path $recordsFile -Encoding UTF8
    Copy-Item $recordsFile $recordsDatedFile -Force

    # Tao CSV UTF-8 BOM
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
    Write-Host "  -> Da tao file Excel CSV: $csvRecFile" -ForegroundColor Cyan

    # 2. Lay danh sach su kien
    Write-Host "[2/3] Dang tai danh sach su kien..." -ForegroundColor Gray
    $actsJson = Invoke-RestMethod -Uri "https://diem-danh-muce.onrender.com/api?action=getActivities" -Method Get -TimeoutSec 30
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
    Write-Host "  -> Da tao file Excel CSV: $csvActFile" -ForegroundColor Cyan

    # 3. Lay danh sach thung rac neu co
    Write-Host "[3/3] Dang kiem tra du lieu thung rac..." -ForegroundColor Gray
    try {
        $trashRecords = Invoke-RestMethod -Uri "https://diem-danh-muce.onrender.com/api?action=getTrashCheckins" -Method Get -TimeoutSec 15
        if ($trashRecords) {
            $trashRecords | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $backupDir "thung_rac_sinh_vien.json") -Encoding UTF8
        }
    } catch {}

    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "  HOAN TAT SAO LUU THANH CONG 100%!" -ForegroundColor Green
    Write-Host "  - Sinh vien: $recCount ban ghi diem danh" -ForegroundColor White
    Write-Host "  - Su kien:   $actCount su kien" -ForegroundColor White
    Write-Host "  - Thu muc luu: $backupDir" -ForegroundColor Yellow
    Write-Host "==========================================================" -ForegroundColor Green

    # Mo thu muc luu
    Invoke-Item $backupDir
} catch {
    Write-Host ""
    Write-Host "Loi khi sao luu: $($_.Exception.Message)" -ForegroundColor Red
}
