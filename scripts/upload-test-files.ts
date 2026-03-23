/**
 * Upload test files to Convex storage for E2E testing.
 * Usage: npx tsx scripts/upload-test-files.ts
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!CONVEX_URL) {
  console.error("Missing NEXT_PUBLIC_CONVEX_URL in .env.local");
  process.exit(1);
}

const client = new ConvexHttpClient(CONVEX_URL);

const TEST_FILES = [
  { path: "public/demo_house.ifc", type: "ifc" as const },
  { path: "public/model.ifc", type: "ifc" as const },
  { path: "public/pdfs/Clinic_076_Finish Schedule.pdf", type: "pdf" as const },
  { path: "public/pdfs/Clinic_070_Equipment Schedule.pdf", type: "pdf" as const },
  { path: "public/pdfs/Clinic_007_Site Layout Plan.pdf", type: "pdf" as const },
];

async function uploadFile(filePath: string, fileType: "ifc" | "pdf") {
  const fullPath = path.resolve(filePath);
  if (!fs.existsSync(fullPath)) {
    console.log(`  SKIP: ${filePath} not found`);
    return null;
  }

  const fileName = path.basename(filePath);
  const fileData = fs.readFileSync(fullPath);
  const sizeBytes = fileData.length;

  console.log(`  Uploading ${fileName} (${(sizeBytes / 1024 / 1024).toFixed(1)} MB)...`);

  // Get upload URL
  const uploadUrl = await client.mutation(api.files.generateUploadUrl);

  // Upload to storage
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": fileType === "ifc" ? "application/octet-stream" : "application/pdf" },
    body: fileData,
  });

  if (!response.ok) {
    console.error(`  FAIL: Upload failed for ${fileName}: ${response.statusText}`);
    return null;
  }

  const { storageId } = (await response.json()) as { storageId: string };
  console.log(`  Stored: ${storageId}`);

  return { storageId, fileName, fileType, sizeBytes };
}

async function main() {
  console.log("Uploading test files to Convex storage...\n");

  // First, ensure we have a project. Create one if needed.
  // We need a project ID for saveUpload. Let's check if one exists.
  let projectId: string | null = null;

  try {
    // Try to create a test project
    const projects: any[] = await client.query(api.projects.list as any);
    if (projects && projects.length > 0) {
      projectId = projects[0]._id;
      console.log(`Using existing project: ${projects[0].name} (${projectId})\n`);
    }
  } catch {
    console.log("No existing projects found.\n");
  }

  for (const file of TEST_FILES) {
    const result = await uploadFile(file.path, file.type);
    if (result && projectId) {
      try {
        await client.mutation(api.files.saveUpload as any, {
          storageId: result.storageId as any,
          name: result.fileName,
          type: result.fileType,
          sizeBytes: result.sizeBytes,
          projectId: projectId as any,
        });
        console.log(`  Saved to DB + pipeline triggered\n`);
      } catch (e: any) {
        console.log(`  Stored in storage but saveUpload failed: ${e.message}\n`);
      }
    } else if (result) {
      console.log(`  Stored in storage (no project to link to)\n`);
    }
  }

  console.log("Done!");
}

main().catch(console.error);
