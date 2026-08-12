# Atoll Chat Performance Benchmark Report 🏝️

Generated on: `2026-08-12T13:41:34.571Z`

| Metric Name | Avg Latency (ms) | p50 (ms) | p95 (ms) | Baseline Target (ms) | Status |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Msg encrypt throughput** | 0.57ms | 0.53ms | 1.31ms | < 15ms | **✅ PASS** |
| **Msg decrypt throughput** | 0.54ms | 0.51ms | 1.44ms | < 15ms | **✅ PASS** |
| **Governance box seal** | 0.65ms | 0.62ms | 1.17ms | < 20ms | **✅ PASS** |
| **Governance box seal_open** | 0.54ms | 0.50ms | 1.41ms | < 20ms | **✅ PASS** |
| **File encrypt (1MB) throughput** | 29.81ms | 29.95ms | 31.66ms | < 100ms | **✅ PASS** |
| **File decrypt (1MB) throughput** | 29.57ms | 29.41ms | 31.74ms | < 100ms | **✅ PASS** |
| **Dexie write throughput (500 messages)** | 83.33ms | 82.74ms | 89.40ms | < 300ms | **✅ PASS** |
| **Dexie query latency (200 messages)** | 42.16ms | 41.93ms | 47.10ms | < 200ms | **✅ PASS** |
| **Admin overview latency (/api/custom/admin/overview)** | 3.02ms | 2.91ms | 4.83ms | < 150ms | **✅ PASS** |
| **Owner public key latency (/api/custom/owner/public-key)** | 2.95ms | 2.86ms | 3.78ms | - | **✅ PASS** |
| **Invite generate latency (/api/custom/invites/generate)** | 2.96ms | 2.81ms | 4.97ms | - | **✅ PASS** |
| **Timeline Render (100 messages)** | 67.00ms | 67.00ms | 67.00ms | < 300ms | **✅ PASS** |
| **Timeline Render (500 messages)** | 429.70ms | 429.70ms | 429.70ms | < 3000ms | **✅ PASS** |
| **Timeline Render (2000 messages)** | 1497.40ms | 1497.40ms | 1497.40ms | < 2000ms | **✅ PASS** |
| **Timeline Scroll FPS** | 59.9 | 59.9 | 59.9 | > 30 | **✅ PASS** |
| **Timeline Scroll Jank Count** | 1.0 | 1.0 | 1.0 | - | **✅ PASS** |
