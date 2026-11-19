// The API still speaks the Mongo-era JSON shape the frontend was built against:
// `id` → `_id`, `clerkId` → `clerkID`, and a nested `interviewerId` object.

export const toDoc = (record) => {
  if (!record) return null;
  const { id, ...rest } = record;
  return { _id: id, ...rest };
};

export const toUserDoc = (user) => {
  if (!user) return null;
  const { id, clerkId, ...rest } = user;
  return { _id: id, clerkID: clerkId, ...rest };
};

export const toInterviewDoc = (iv) => {
  if (!iv) return null;
  const { id, interviewer, interviewerId, ...rest } = iv;
  const doc = { _id: id, ...rest };
  if (interviewer) {
    doc.interviewerId = {
      _id: interviewer.id,
      name: interviewer.name,
      email: interviewer.email,
      clerkID: interviewer.clerkId,
    };
  } else {
    doc.interviewerId = interviewerId;
  }
  return doc;
};
