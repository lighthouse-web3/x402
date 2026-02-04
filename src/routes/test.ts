import express from "express";
import {
  getFileById,
  getFilesByStatus,
  markFileUploaded,
  markFileSentForDeal,
  clearS3Key,
  markFileFailed,
} from "../db/x402/fileTracking.js";
import { deleteFromS3 } from "../services/s3/wasabiClient.js";
import {
  triggerS3ToIpfsProcessing,
  triggerDealChecking,
} from "../workers/index.js";
import config from "../config/index.js";

const router = express.Router();

/**
 * GET /api/test/files
 * List all files in the database
 */
router.get("/files", async (req, res) => {
  try {
    const status = req.query.status as string;

    let files;
    if (status) {
      files = await getFilesByStatus(status as any);
    } else {
      // Get all files by querying each status
      const queued = await getFilesByStatus("queued");
      const uploading = await getFilesByStatus("uploading");
      const uploaded = await getFilesByStatus("uploaded");
      const failed = await getFilesByStatus("failed");

      files = [...queued, ...uploading, ...uploaded, ...failed];
    }

    res.json({
      success: true,
      count: files.length,
      files: files.map((f) => ({
        id: f.id,
        fileName: f.fileName,
        fileSizeInBytes: f.fileSizeInBytes,
        storageStage: f.storageStage,
        blockStatus: f.blockStatus,
        cid: f.cid,
        sentForDeal: f.sentForDeal,
        encryption: f.encryption,
        s3Key: f.s3Key,
        createdAt: f.createdAt,
        lastUpdate: f.lastUpdate,
      })),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/test/files/:id
 * Get a specific file by ID
 */
router.get("/files/:id", async (req, res) => {
  try {
    const file = await getFileById(req.params.id);

    if (!file) {
      return res.status(404).json({ error: "File not found" });
    }

    res.json({ success: true, file });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/test/files/:id/mock-ipfs
 * Mock IPFS upload - set a fake CID to simulate IPFS upload completion
 */
router.post("/files/:id/mock-ipfs", async (req, res) => {
  try {
    const { id } = req.params;
    const { cid } = req.body;

    const file = await getFileById(id);
    if (!file) {
      return res.status(404).json({ error: "File not found" });
    }

    // Generate a fake CID if not provided
    const fakeCid =
      cid || `QmTest${Date.now()}${Math.random().toString(36).substring(7)}`;

    await markFileUploaded(id, fakeCid);

    res.json({
      success: true,
      message: "File marked as uploaded with mock CID",
      id,
      cid: fakeCid,
      ipfsUrl: `https://gateway.lighthouse.storage/ipfs/${fakeCid}`,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/test/files/:id/mock-deal
 * Mock deal completion - simulate deal being confirmed
 */
router.post("/files/:id/mock-deal", async (req, res) => {
  try {
    const { id } = req.params;
    const { deleteS3 } = req.body;

    const file = await getFileById(id);
    if (!file) {
      return res.status(404).json({ error: "File not found" });
    }

    // Mark as sent for deal
    await markFileSentForDeal(id);

    let s3Deleted = false;

    // Optionally delete from S3
    if (deleteS3 && file.s3Key) {
      const deleteResult = await deleteFromS3(file.s3Key);
      if (deleteResult.success) {
        await clearS3Key(id);
        s3Deleted = true;
      }
    }

    res.json({
      success: true,
      message: "File marked as sent for deal",
      id,
      s3Deleted,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/test/files/:id/mark-failed
 * Mark a file as failed
 */
router.post("/files/:id/mark-failed", async (req, res) => {
  try {
    const { id } = req.params;
    const { error: errorMessage } = req.body;

    const file = await getFileById(id);
    if (!file) {
      return res.status(404).json({ error: "File not found" });
    }

    await markFileFailed(id, errorMessage || "Manually marked as failed");

    res.json({
      success: true,
      message: "File marked as failed",
      id,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/test/trigger-s3-to-ipfs
 * Manually trigger the S3 to IPFS worker
 */
router.post("/trigger-s3-to-ipfs", async (req, res) => {
  try {
    if (!config.lighthouse_api_key) {
      return res.status(400).json({
        error: "LIGHTHOUSE_API_KEY not configured",
        message:
          "Use /api/test/files/:id/mock-ipfs to simulate IPFS upload instead",
      });
    }

    await triggerS3ToIpfsProcessing();

    res.json({
      success: true,
      message: "S3 to IPFS worker triggered",
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/test/trigger-deal-checker
 * Manually trigger the deal checker worker
 */
router.post("/trigger-deal-checker", async (req, res) => {
  try {
    await triggerDealChecking();

    res.json({
      success: true,
      message: "Deal checker worker triggered",
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/test/config
 * Show current configuration (for debugging)
 */
router.get("/config", (req, res) => {
  res.json({
    environment: config.environment,
    workersEnabled: config.workers_enabled,
    lighthouseApiKeySet: !!config.lighthouse_api_key,
    s3ToIpfsInterval: `${config.s3_to_ipfs_interval / 1000} seconds`,
    dealCheckInterval: `${config.deal_check_interval / 1000} seconds`,
    wasabiEndpoint: config.wasabi_endpoint,
    awsEndpoint: config.aws_endpoint || "AWS (not LocalStack)",
  });
});

export default router;
