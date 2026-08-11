# Atoll Chat Performance Benchmark Report 🏝️

Generated on: `2026-08-11T07:21:59.488Z`

| Metric Name | Avg Latency (ms) | p50 (ms) | p95 (ms) | Baseline Target (ms) | Status |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Msg encrypt throughput** | 3.21ms | 3.04ms | 5.68ms | < 15ms | **✅ PASS** |
| **Msg decrypt throughput** | 3.13ms | 2.86ms | 6.31ms | < 15ms | **✅ PASS** |
| **Governance box seal** | 3.69ms | 3.32ms | 8.49ms | < 20ms | **✅ PASS** |
| **File encrypt (1MB) throughput** | 50.39ms | 49.59ms | 53.28ms | < 100ms | **✅ PASS** |
| **Dexie write throughput (500 messages)** | 208.64ms | 207.42ms | 212.24ms | < 300ms | **✅ PASS** |
| **Dexie query latency (200 messages)** | 104.64ms | 101.24ms | 113.91ms | < 200ms | **✅ PASS** |
| **Admin overview latency (/api/custom/admin/overview)** | 8.10ms | 7.70ms | 14.17ms | < 150ms | **✅ PASS** |
| **Owner public key latency (/api/custom/owner/public-key)** | 8.45ms | 8.00ms | 14.15ms | - | **✅ PASS** |
| **Invite generate latency (/api/custom/invites/generate)** | 9.15ms | 8.61ms | 15.84ms | - | **✅ PASS** |
| **Timeline Render (100 messages)** | 86.60ms | 86.60ms | 86.60ms | - | **✅ PASS** |
| **Timeline Render (500 messages)** | 2021.60ms | 2021.60ms | 2021.60ms | < 3000ms | **✅ PASS** |
| **Timeline Render (2000 messages)** | 21785.30ms | 21785.30ms | 21785.30ms | - | **✅ PASS** |
| **Timeline Scroll FPS** | 54.7 | 54.7 | 54.7 | > 30 | **✅ PASS** |
| **Timeline Scroll Jank Count** | 9.0 | 9.0 | 9.0 | - | **✅ PASS** |
