@echo off
chcp 65001 >nul
title HỆ THỐNG SAO LƯU DỮ LIỆU ĐIỂM DANH GPS - ĐH XÂY DỰNG MIỀN TRUNG
color 0b
echo ===================================================================
echo     HỆ THỐNG SAO LƯU DỮ LIỆU ĐIỂM DANH GPS - MUCE (1-CLICK)
echo ===================================================================
echo.
echo Đang kết nối máy chủ Render để sao lưu dữ liệu mới nhất...
echo.

set "SCRIPT_DIR=%~dp0"
if exist "%SCRIPT_DIR%backup_script.ps1" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%backup_script.ps1"
) else if exist "C:\Users\DELL\Desktop\BACKUP_DIEM_DANH_MUCE\backup_script.ps1" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\DELL\Desktop\BACKUP_DIEM_DANH_MUCE\backup_script.ps1"
) else if exist "C:\Users\DELL\Downloads\DIEM_DANH_MUCE-main\backup_script.ps1" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\DELL\Downloads\DIEM_DANH_MUCE-main\backup_script.ps1"
)

echo.
echo ===================================================================
echo Nhấn phím bất kỳ để đóng cửa sổ này...
pause >nul
