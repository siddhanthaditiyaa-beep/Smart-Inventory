from flask import Flask, request, jsonify
import cv2
import os
import hashlib
import random

app = Flask(__name__)

@app.route("/process-shelf-image", methods=["POST"])
def process_shelf():

    data = request.get_json()

    if not data or "imagePath" not in data:
        return jsonify({"error": "Invalid request"}), 400

    image_path = "." + data["imagePath"]

    if not os.path.exists(image_path):
        return jsonify({"error": "Image not found"}), 404

    img = cv2.imread(image_path)

    if img is None:
        return jsonify({"error": "Failed to load image"}), 500

    # Create unique hash from image
    image_hash = hashlib.md5(img.tobytes()).hexdigest()

    # Convert hash → seed
    seed = int(image_hash[:8], 16)

    random.seed(seed)

    total_slots = 20

    # Generate deterministic shelf layout
    occupied = sorted(random.sample(range(1, total_slots + 1), random.randint(10,16)))

    empty = [i for i in range(1, total_slots + 1) if i not in occupied]

    return jsonify({
        "shelf_id": 1,
        "occupied_slot_numbers": occupied,
        "empty_slot_numbers": empty
    })


if __name__ == "__main__":
    app.run(port=5001)