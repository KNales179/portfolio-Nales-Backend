import multer from "multer";

// Store the uploaded file temporarily in memory.
// We send it directly to Cloudinary afterward.
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Only image files are allowed"), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
  },
});

// ------------------------------------------------------------
// PDF documents (the résumé). Kept separate from image uploads
// so the mime filter and size limit can differ.
// ------------------------------------------------------------

const pdfFilter = (req, file, cb) => {
  if (file.mimetype === "application/pdf") {
    cb(null, true);
  } else {
    cb(new Error("Only PDF files are allowed"), false);
  }
};

export const uploadDocument = multer({
  storage,
  fileFilter: pdfFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  },
});

export default upload;