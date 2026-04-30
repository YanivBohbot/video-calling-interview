import { prisma } from "./db.js";

const seedData = async () => {
  try {
    console.log("Clearing existing data...");
    await prisma.interview.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    console.log("Data cleared.");

    const users = await Promise.all([
      prisma.user.create({
        data: {
          name: "Alice Martin",
          email: "alice@example.com",
          clerkId: "clerk_alice_001",
          profileImage: "https://example.com/alice.png",
        },
      }),
      prisma.user.create({
        data: {
          name: "Bob Carter",
          email: "bob@example.com",
          clerkId: "clerk_bob_002",
          profileImage: "https://example.com/bob.png",
        },
      }),
      prisma.user.create({
        data: {
          name: "Eve Summers",
          email: "eve@example.com",
          clerkId: "clerk_eve_003",
          profileImage: "https://example.com/eve.png",
        },
      }),
    ]);
    console.log(`Seeded ${users.length} users.`);

    await prisma.session.createMany({
      data: [
        {
          problem: "Two Sum",
          difficulty: "easy",
          category: "Arrays",
          solution: "function twoSum(nums, target) { ... }",
        },
        {
          problem: "Reverse Linked List",
          difficulty: "medium",
          category: "Linked Lists",
          solution: "function reverseList(head) { ... }",
        },
        {
          problem: "Binary Tree Level Order Traversal",
          difficulty: "hard",
          category: "Trees",
          solution: "function levelOrder(root) { ... }",
        },
      ],
    });
    console.log("Seeded 3 sessions.");

    await prisma.interview.createMany({
      data: [
        {
          interviewerId: users[0].id,
          candidateName: "Sarah Johnson",
          candidateEmail: "sarah@example.com",
          role: "Frontend Developer",
          scheduledAt: new Date(Date.now() + 1000 * 60 * 60 * 2),
          status: "scheduled",
        },
        {
          interviewerId: users[1].id,
          candidateName: "Michael Chen",
          candidateEmail: "michael@example.com",
          role: "Full Stack Engineer",
          scheduledAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
          status: "scheduled",
        },
        {
          interviewerId: users[2].id,
          candidateName: "Alex Rivera",
          candidateEmail: "alex@example.com",
          role: "Product Designer",
          scheduledAt: new Date(Date.now() + 1000 * 60 * 60 * 48),
          status: "scheduled",
        },
      ],
    });
    console.log("Seeded 3 interviews.");

    console.log("Seeding complete!");
    process.exit(0);
  } catch (err) {
    console.error("Seeding failed:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
};

seedData();
