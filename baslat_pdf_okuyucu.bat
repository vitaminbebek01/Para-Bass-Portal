@echo off
title Para Bass Portal - PDF Okuyucu Sunucusu
echo ===================================================
echo Para Bass Portal - PDF Okuma Sunucusu Baslatiliyor...
echo Lutfen bu pencereyi KAPATMAYIN.
echo Kapatirsaniz PDF okuma islemi calismaz!
echo ===================================================
cd backend
py -m uvicorn main:app --reload
pause
