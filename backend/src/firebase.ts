import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import path from "path";

// Si tu archivo está en src/firebase.ts y el json en la raíz del backend:
const serviceAccountPath = path.resolve(__dirname, "../notificaciondocapp-firebase-adminsdk-fbsvc-0c178745ac.json");

const app =
  getApps().length === 0
    ? initializeApp({
        credential: cert(serviceAccountPath),
      })
    : getApps()[0];

export const fcm = getMessaging(app);