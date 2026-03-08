from flask import Flask, request, jsonify
import random

app = Flask(__name__)

@app.route("/process-shelf-image", methods=["POST"])
def process_shelf():

    # Simulated AI detection
    present = ["Chips","Juice","Crackers"]
    missing = ["Biscuits","Cookies"]

    total_slots = 20
    occupied = random.sample(range(1,21),12)

    return jsonify({
        "shelf_id":1,
        "occupied_slot_numbers":occupied,
        "empty_slot_numbers":[i for i in range(1,21) if i not in occupied]
    })

app.run(port=5001)