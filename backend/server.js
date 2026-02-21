const express = require("express");
const cors = require("cors");
const axios = require("axios");
const multer = require("multer");
const FormData = require("form-data");
const crypto = require("crypto");
require("dotenv").config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
});

// Configuration من Environment Variables
const PINATA_API_KEY = process.env.PINATA_API_KEY || "eb91f4b6878052203f6f";
const PINATA_SECRET_KEY =
  process.env.PINATA_SECRET_KEY ||
  "2f477b1f6c6e083654fd6f0be755498c8616a2a1fc5fdd55723ca220d78b90e6";
const FIREFLY_URL = process.env.FIREFLY_URL || "http://127.0.0.1:5000";
const PORT = process.env.PORT || 3001;

// Helper: حساب SHA256 Hash للملف
function calculateFileHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

// Helper: إرسال رسالة للـ Blockchain
async function sendToBlockchain(data) {
  try {
    const response = await axios.post(
      `${FIREFLY_URL}/api/v1/namespaces/default/messages/broadcast`,
      {
        data: [
          {
            datatype: { name: "audit_record", version: "0.0.1" },
            value: data,
          },
        ],
      },
      { timeout: 10000 }, // 10 seconds timeout
    );
    return { success: true, data: response.data };
  } catch (error) {
    console.error("❌ FireFly Error:", error.message);
    throw new Error(`Blockchain connection failed: ${error.message}`);
  }
}

// ============================================
// 📤 ENDPOINT 1: Upload Full (IPFS + Blockchain)
// ============================================
app.post("/api/upload-full", upload.single("file"), async (req, res) => {
  try {
    const { invoice_id, amount } = req.body;
    const file = req.file;

    // Validation
    if (!file) {
      return res.status(400).json({ error: "Aucun fichier reçu" });
    }
    if (!invoice_id || !amount) {
      return res.status(400).json({ error: "invoice_id et amount requis" });
    }

    console.log(`📤 Upload pour Invoice: ${invoice_id}, Montant: ${amount}`);

    // 1️⃣ Calculer le Hash du fichier AVANT l'upload
    const fileHash = calculateFileHash(file.buffer);
    console.log(`🔐 Hash calculé: ${fileHash.substring(0, 16)}...`);

    // 2️⃣ Upload à IPFS via Pinata
    const formData = new FormData();
    formData.append("file", file.buffer, file.originalname);

    let ipfsHash;
    try {
      const pinataRes = await axios.post(
        "https://api.pinata.cloud/pinning/pinFileToIPFS",
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            pinata_api_key: PINATA_API_KEY,
            pinata_secret_api_key: PINATA_SECRET_KEY,
          },
          timeout: 30000, // 30 seconds
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        },
      );

      ipfsHash = pinataRes.data.IpfsHash;
      console.log(`✅ IPFS Upload réussi: ${ipfsHash}`);
    } catch (ipfsError) {
      console.error("❌ IPFS Error:", ipfsError.message);

      // إرجاع error واضح للـ Frontend
      if (ipfsError.code === "ENOTFOUND") {
        return res.status(503).json({
          error: "IPFS Connection Failed",
          details:
            "Impossible de contacter api.pinata.cloud. Vérifiez votre connexion internet.",
        });
      }

      return res.status(500).json({
        error: "IPFS Upload Failed",
        details: ipfsError.response?.data || ipfsError.message,
      });
    }

    // 3️⃣ Enregistrer dans la Blockchain
    const blockchainData = {
      invoice_id: invoice_id,
      amount: parseFloat(amount),
      status: "EN ATTENTE",
      file_hash: fileHash, // ✅ Hash du fichier
      ipfs_hash: ipfsHash, // ✅ Hash IPFS
      file_ref: `https://gateway.pinata.cloud/ipfs/${ipfsHash}`,
      timestamp: new Date().toISOString(),
    };

    try {
      await sendToBlockchain(blockchainData);
      console.log(`✅ Blockchain enregistrement réussi`);

      res.json({
        success: true,
        ipfsHash: ipfsHash,
        fileHash: fileHash,
        message: "Facture enregistrée avec succès",
      });
    } catch (blockchainError) {
      // IPFS a réussi, mais Blockchain a échoué
      console.error("❌ Blockchain Error après IPFS:", blockchainError.message);

      res.status(207).json({
        // 207 = Multi-Status
        success: false,
        ipfsHash: ipfsHash, // Fichier sauvegardé quand même
        error: "Blockchain Failed",
        details: blockchainError.message,
      });
    }
  } catch (error) {
    console.error("❌ Erreur générale:", error);
    res.status(500).json({
      error: "Erreur serveur",
      details: error.message,
    });
  }
});

// ============================================
// 📝 ENDPOINT 2: Update Audit Status
// ============================================
app.post("/api/audit", async (req, res) => {
  const { invoice_id, amount, status, file_ref, file_hash } = req.body;

  try {
    // Validation
    if (!invoice_id || !status) {
      return res.status(400).json({ error: "invoice_id et status requis" });
    }

    console.log(`📝 Update Audit: ${invoice_id} → ${status}`);

    const blockchainData = {
      invoice_id,
      amount: parseFloat(amount),
      status: status,
      file_ref: file_ref,
      file_hash: file_hash,
      timestamp: new Date().toISOString(),
    };

    await sendToBlockchain(blockchainData);

    res.json({
      success: true,
      message: `Facture ${invoice_id} marquée comme ${status}`,
    });
  } catch (error) {
    console.error("❌ Audit Update Error:", error);
    res.status(500).json({
      error: "Blockchain Update Failed",
      details: error.message,
    });
  }
});

// ============================================
// 🔍 ENDPOINT 3: Verify File Integrity (NOUVEAU!)
// ============================================
app.post("/api/verify", upload.single("file"), async (req, res) => {
  try {
    const { invoice_id, expected_hash } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "Aucun fichier à vérifier" });
    }

    console.log(`🔍 Vérification pour Invoice: ${invoice_id}`);

    // Calculer le Hash du fichier uploadé
    const actualHash = calculateFileHash(file.buffer);

    // Comparer avec le Hash dans la Blockchain
    const isValid = actualHash === expected_hash;

    console.log(`🔐 Hash actuel: ${actualHash.substring(0, 16)}...`);
    console.log(`🔐 Hash attendu: ${expected_hash.substring(0, 16)}...`);
    console.log(`✅ Vérification: ${isValid ? "VALIDE ✓" : "INVALIDE ✗"}`);

    res.json({
      success: true,
      isValid: isValid,
      actualHash: actualHash,
      expectedHash: expected_hash,
      message: isValid
        ? "✅ Le fichier est authentique et n'a pas été modifié"
        : "❌ ATTENTION: Le fichier a été altéré ou ne correspond pas à l'original",
    });
  } catch (error) {
    console.error("❌ Verify Error:", error);
    res.status(500).json({
      error: "Erreur de vérification",
      details: error.message,
    });
  }
});

// ============================================
// 📊 ENDPOINT 4: Get All Records (NOUVEAU!)
// ============================================
app.get("/api/records", async (req, res) => {
  try {
    // Récupérer les messages du Blockchain
    const response = await axios.get(
      `${FIREFLY_URL}/api/v1/namespaces/default/messages`,
      { timeout: 10000 },
    );

    // Filtrer les messages de type "audit_record"
    const auditRecords = response.data
      .filter((msg) => msg.header?.type === "audit_record")
      .map((msg) => msg.data);

    console.log(`📊 ${auditRecords.length} enregistrements trouvés`);

    res.json({
      success: true,
      records: auditRecords,
    });
  } catch (error) {
    console.error("❌ Get Records Error:", error);
    res.status(500).json({
      error: "Impossible de récupérer les enregistrements",
      details: error.message,
    });
  }
});

// ============================================
// 🏥 Health Check Endpoint
// ============================================
app.get("/api/health", async (req, res) => {
  const health = {
    server: "OK",
    pinata: "UNKNOWN",
    firefly: "UNKNOWN",
  };

  // Test Pinata
  try {
    await axios.get("https://api.pinata.cloud", { timeout: 5000 });
    health.pinata = "OK";
  } catch (e) {
    health.pinata = "FAILED";
  }

  // Test FireFly
  try {
    await axios.get(`${FIREFLY_URL}/api/v1/status`, { timeout: 5000 });
    health.firefly = "OK";
  } catch (e) {
    health.firefly = "FAILED";
  }

  const allHealthy = Object.values(health).every((v) => v === "OK");
  res.status(allHealthy ? 200 : 503).json(health);
});

// ============================================
// Error Handling Middleware
// ============================================
app.use((err, req, res, next) => {
  console.error("❌ Unhandled Error:", err);
  res.status(500).json({
    error: "Erreur serveur interne",
    details: err.message,
  });
});

// ============================================
// Start Server
// ============================================
app.listen(PORT, () => {
  console.log(`
🚀 Backend AuditChain démarré!
📡 Port: ${PORT}
🔗 Pinata: ${PINATA_API_KEY ? "✅ Configuré" : "❌ Manquant"}
⛓️  FireFly: ${FIREFLY_URL}
    `);
});
