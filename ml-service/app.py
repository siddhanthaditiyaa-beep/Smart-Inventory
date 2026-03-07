print("🔥 app.py loaded")

from flask import Flask, request, jsonify
from PIL import Image
import numpy as np
import os

# NEW IMPORT FOR YOLO
from ultralytics import YOLO

app = Flask(__name__)

# -------------------------------
# CONFIG
# -------------------------------
TOTAL_SLOTS = 10
EMPTY_THRESHOLD = 220

# -------------------------------
# LOAD YOLO MODEL (NEW)
# -------------------------------
print("🧠 Loading YOLO model...")
model = YOLO("yolov8n.pt")

# -------------------------------
# HEALTH CHECK
# -------------------------------
@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


# -------------------------------
# PROCESS SHELF IMAGE (EXISTING)
# -------------------------------
@app.route("/process-shelf-image", methods=["POST"])
def process_shelf_image():
    data = request.json
    image_path = data.get("imagePath")

    if not image_path:
        return jsonify({"error": "imagePath required"}), 400

    image_path = image_path.lstrip("/")

    if not os.path.exists(image_path):
        return jsonify({"error": f"Image not found: {image_path}"}), 404

    img = Image.open(image_path).convert("L")
    img_np = np.array(img)

    width, height = img.size
    slot_width = width // TOTAL_SLOTS

    occupied = []
    empty = []

    for i in range(TOTAL_SLOTS):
        x_start = i * slot_width
        x_end = x_start + slot_width
        slot = img_np[:, x_start:x_end]
        avg_brightness = np.mean(slot)

        if avg_brightness < EMPTY_THRESHOLD:
            occupied.append(i + 1)
        else:
            empty.append(i + 1)

    response = {
        "shelf_id": "SHELF_001",
        "total_slots": TOTAL_SLOTS,
        "occupied_slots": len(occupied),
        "empty_slots": len(empty),
        "occupied_slot_numbers": occupied,
        "empty_slot_numbers": empty
    }

    return jsonify(response)


# -------------------------------
# YOLO PRODUCT DETECTION (NEW)
# -------------------------------
@app.route("/detect-products", methods=["POST"])
def detect_products():

    data = request.json
    image_path = data.get("imagePath")

    if not image_path:
        return jsonify({"error": "imagePath required"}), 400

    image_path = image_path.lstrip("/")

    if not os.path.exists(image_path):
        return jsonify({"error": "Image not found"}), 404

    print(f"🔍 Running YOLO on {image_path}")

    results = model(image_path)

    detected_products = []

    for r in results:
        for cls in r.boxes.cls:
            label = model.names[int(cls)]
            detected_products.append(label)

    return jsonify({
        "products": detected_products
    })


# -------------------------------
# START SERVER
# -------------------------------
if __name__ == "__main__":
    print("🚀 Starting Flask ML service on port 5001")
    app.run(host="127.0.0.1", port=5001, debug=True)