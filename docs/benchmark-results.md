# Atoll Chat Performance Benchmark Report 🏝️

Generated on: `2026-08-11T13:51:11.309Z`

| Metric Name | Avg Latency (ms) | p50 (ms) | p95 (ms) | Baseline Target (ms) | Status |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Msg encrypt throughput** | 0.61ms | 0.58ms | 1.28ms | < 15ms | **✅ PASS** |
| **Msg decrypt throughput** | 0.55ms | 0.51ms | 1.18ms | < 15ms | **✅ PASS** |
| **Governance box seal** | 0.70ms | 0.64ms | 1.81ms | < 20ms | **✅ PASS** |
| **Governance box seal_open** | 0.54ms | 0.51ms | 1.14ms | < 20ms | **✅ PASS** |
| **File encrypt (1MB) throughput** | 32.54ms | 32.43ms | 34.70ms | < 100ms | **✅ PASS** |
| **File decrypt (1MB) throughput** | 32.16ms | 32.27ms | 33.61ms | < 100ms | **✅ PASS** |
| **Dexie write throughput (500 messages)** | 86.31ms | 85.40ms | 89.21ms | < 300ms | **✅ PASS** |
| **Dexie query latency (200 messages)** | 44.92ms | 43.67ms | 49.37ms | < 200ms | **✅ PASS** |
| **Admin overview latency (/api/custom/admin/overview)** | 3.82ms | 3.71ms | 5.33ms | < 150ms | **✅ PASS** |
| **Owner public key latency (/api/custom/owner/public-key)** | 3.53ms | 3.47ms | 4.93ms | - | **✅ PASS** |
| **Invite generate latency (/api/custom/invites/generate)** | 3.55ms | 3.41ms | 5.33ms | - | **✅ PASS** |
| **Timeline Render (100 messages)** | 64.60ms | 64.60ms | 64.60ms | - | **✅ PASS** |
| **Timeline Render (500 messages)** | 955.20ms | 955.20ms | 955.20ms | < 3000ms | **✅ PASS** |
| **Timeline Render (2000 messages)** | 8953.50ms | 8953.50ms | 8953.50ms | - | **✅ PASS** |
| **Timeline Scroll FPS** | 57.4 | 57.4 | 57.4 | > 30 | **✅ PASS** |
| **Timeline Scroll Jank Count** | 7.0 | 7.0 | 7.0 | - | **✅ PASS** |
