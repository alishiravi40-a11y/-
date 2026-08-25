/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Camera, RefreshCw, X, Sparkles, CheckCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Html5Qrcode } from 'html5-qrcode';

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  onClose: () => void;
}

export default function BarcodeScanner({ onScan, onClose }: BarcodeScannerProps) {
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [scannedResult, setScannedResult] = useState<string | null>(null);
  const [simulatedSerial, setSimulatedSerial] = useState('');
  
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isPausedRef = useRef(false);
  const [isPaused, setIsPaused] = useState(false);

  const mockSerials = [
    '358962104587412', // Galaxy S24 Ultra IMEI
    '354215896321458', // iPhone 15 Pro Max IMEI
    '8806091234567',   // Samsung barcode
    '190198451234',    // Apple barcode
    'IMEI-89621-9982'  // General Serial
  ];

  useEffect(() => {
    let html5QrCode: Html5Qrcode | null = null;
    let isMounted = true;

    Html5Qrcode.getCameras().then(devices => {
      if (devices && devices.length && isMounted) {
        setHasCameraPermission(true);
        html5QrCode = new Html5Qrcode("reader");
        scannerRef.current = html5QrCode;

        html5QrCode.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0
          },
          (decodedText) => {
            handleRealScan(decodedText);
          },
          () => {
            // parse error, ignore it.
          }
        ).catch((err) => {
          console.warn("Camera start failed:", err);
          if (isMounted) setHasCameraPermission(false);
        });
      } else if (isMounted) {
        setHasCameraPermission(false);
      }
    }).catch(err => {
      console.warn("Camera access failed:", err);
      if (isMounted) setHasCameraPermission(false);
    });

    return () => {
      isMounted = false;
      if (scannerRef.current) {
        scannerRef.current.stop().catch(console.warn).finally(() => {
           scannerRef.current?.clear();
        });
      }
    };
  }, []);

  const handleRealScan = (text: string) => {
    if (isPausedRef.current) return;
    
    isPausedRef.current = true;
    setIsPaused(true);
    setScannedResult(text);
    
    // Pause the scanner to prevent multiple reads of the same barcode
    if (scannerRef.current && scannerRef.current.getState() === 2) {
      scannerRef.current.pause();
    }
    
    // Send to parent
    onScan(text);
    
    // After 1.5 seconds, resume scanning
    setTimeout(() => {
      setScannedResult(null);
      setIsPaused(false);
      isPausedRef.current = false;
      if (scannerRef.current && scannerRef.current.getState() === 3) {
        scannerRef.current.resume();
      }
    }, 1500);
  };

  const handleSimulateScan = (serial: string) => {
    if (isPausedRef.current) return;
    isPausedRef.current = true;
    setIsPaused(true);
    setScannedResult(serial);
    onScan(serial);
    
    setTimeout(() => {
      setScannedResult(null);
      setIsPaused(false);
      isPausedRef.current = false;
    }, 1500);
  };

  const handleManualSimulate = () => {
    const val = simulatedSerial.trim() || mockSerials[Math.floor(Math.random() * mockSerials.length)];
    handleSimulateScan(val);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/85 backdrop-blur-sm">
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4 text-white z-10">
        <h3 className="font-sans text-lg font-semibold tracking-tight">اسکنر بارکد و سریال (IMEI)</h3>
        <button 
          onClick={onClose} 
          className="rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
        >
          <X size={20} />
        </button>
      </div>

      <div className="relative flex-1 flex flex-col items-center justify-center p-6">
        {/* Camera Feed or Permission Alert */}
        <div className="relative aspect-square w-full max-w-[280px] overflow-hidden rounded-2xl border-2 border-dashed border-emerald-500 bg-zinc-900 shadow-2xl flex flex-col items-center justify-center">
          
          <div id="reader" className="w-full h-full [&_video]:object-cover [&_video]:h-full" style={{ display: hasCameraPermission ? 'block' : 'none' }}></div>
          
          {hasCameraPermission === null && (
            <div className="absolute inset-0 flex flex-col items-center justify-center space-y-2 text-zinc-400 bg-zinc-900 z-10">
              <RefreshCw className="animate-spin text-emerald-500" size={32} />
              <span className="font-sans text-xs">در حال راه‌اندازی دوربین...</span>
            </div>
          )}

          {hasCameraPermission === false && (
            <div className="absolute inset-0 p-4 text-center flex flex-col items-center justify-center space-y-3 bg-zinc-900 z-10">
              <Camera className="text-zinc-500" size={40} />
              <span className="font-sans text-xs text-zinc-400 leading-relaxed">
                دسترسی به دوربین مسدود شده یا یافت نشد. می‌توانید از شبیه‌ساز اسکنر زیر استفاده کنید.
              </span>
            </div>
          )}

          {/* Scan Overlay Overlay Line */}
          {hasCameraPermission && !isPaused && (
            <>
              <div className="absolute inset-x-4 top-1/2 h-[2px] bg-red-500 shadow-[0_0_10px_2px_rgba(239,68,68,0.7)] animate-[bounce_2s_infinite] pointer-events-none z-10" />
              <div className="absolute inset-6 border border-emerald-500/20 pointer-events-none rounded-lg z-10" />
            </>
          )}

          {/* Success scan confirmation */}
          <AnimatePresence>
            {scannedResult && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="absolute inset-0 bg-zinc-950/90 flex flex-col items-center justify-center p-4 text-center z-20"
              >
                <CheckCircle className="text-emerald-500 mb-2 animate-bounce" size={40} />
                <span className="font-sans text-sm font-semibold text-white mb-2">اسکن موفقیت‌آمیز!</span>
                <span className="font-mono text-xs text-emerald-400 mt-1 select-all bg-emerald-500/10 px-3 py-1.5 rounded-lg border border-emerald-500/30">{scannedResult}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <span className="font-sans text-xs text-zinc-500 mt-3 text-center">
          {hasCameraPermission ? "بارکد یا IMEI جعبه گوشی را مقابل دوربین بگیرید. پس از اسکن، دوربین برای کد بعدی آماده می‌شود." : "شبیه‌ساز هوشمند اسکنر"}
        </span>
      </div>

      {/* Simulator Sheet */}
      <div className="bg-zinc-900 border-t border-zinc-800 rounded-t-[2.5rem] p-6 text-white pb-8">
        <div className="w-12 h-1.5 bg-zinc-700 rounded-full mx-auto mb-5" />
        
        <div className="space-y-4">
          <div className="flex items-center space-x-2 space-x-reverse text-emerald-400">
            <Sparkles size={16} />
            <span className="font-sans text-xs font-semibold">انتخاب سریال‌های از پیش تعریف شده (تست سریع):</span>
          </div>

          <div className="flex flex-wrap gap-2">
            {mockSerials.map((serial) => (
              <button
                key={serial}
                onClick={() => handleSimulateScan(serial)}
                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/50 hover:border-emerald-500/50 rounded-lg px-3 py-1.5 font-mono text-[11px] transition-all flex items-center space-x-1 space-x-reverse"
              >
                <span>IMEI:</span>
                <span className="text-emerald-400 font-bold">{serial.substring(0, 5)}...</span>
              </button>
            ))}
          </div>

          <div className="relative flex items-center bg-zinc-800 rounded-xl px-3 py-2 border border-zinc-700">
            <input
              type="text"
              value={simulatedSerial}
              onChange={(e) => setSimulatedSerial(e.target.value)}
              placeholder="تایپ دستی سریال جهت شبیه‌سازی اسکن"
              className="w-full bg-transparent font-sans text-xs text-white placeholder-zinc-500 focus:outline-none text-right"
              dir="rtl"
            />
            <button
              onClick={handleManualSimulate}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-sans text-xs font-semibold rounded-lg px-3 py-1.5 transition-all mr-2 shrink-0"
            >
              ثبت اسکن
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
