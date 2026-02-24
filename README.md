# 📑AuditTrust AI: Intelligent Internal Audit System using Blockchain and Machine Learning

**Status:** 🚧 Work In Progress (Development Phase)

## 📌 Project Overview

**AuditChain** is a decentralized application (DApp) designed to enhance transparency and integrity in financial auditing. It provides a secure platform where:

* **Accountants** can seal invoices on the blockchain to prevent retroactive changes.
* **Auditors** can verify the authenticity of documents by fetching records directly from the ledger.

## 🛠 Tech Stack

* **Frontend:** React.js, Tailwind CSS (Modern Glassmorphism UI).
* **Backend:** Node.js, Express.
* **Blockchain Orchestrator:** Hyperledger FireFly.
* **Decentralized Storage:** IPFS via Pinata Gateway.

## 🚀 Current Progress & Features

* [x] Multi-role Dashboard (Comptable/Auditeur).
* [x] Hybrid Data Flow: Metadata on Blockchain & Files on IPFS.
* [x] Blockchain Message Broadcasting via FireFly.
* [ ] Automated Hash Verification (In Progress).
* [ ] Advanced Error Handling for Network Issues (Pending).

## ⚠️ Known Issues

* **Connectivity:** IPFS upload currently requires a stable internet connection for Pinata API; otherwise, the server returns an `ENOTFOUND` error.
* **Sync:** The UI table might initialize as an empty array if the backend fails to fetch from the blockchain nodes during downtime.

