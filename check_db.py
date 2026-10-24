import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate("service_account.json")
firebase_admin.initialize_app(cred)
db = firestore.client()
docs = db.collection("wind_forecasts").get()
print("Doc count:", len(docs))
if len(docs) > 0:
    for doc in docs[:2]:
        print(doc.id, doc.to_dict())
