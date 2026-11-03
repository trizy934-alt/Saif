export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    const signature = request.headers.get("x-signature-ed25519");
    const timestamp = request.headers.get("x-signature-timestamp");
    const body = await request.text();

    // التحقق من توقيع ديسكورد (مهم جداً)
    if (!signature || !timestamp) return new Response("Missing headers", { status: 401 });
    const isValid = await verifySignature(body, signature, timestamp, env.DISCORD_PUBLIC_KEY);
    if (!isValid) return new Response("Invalid request signature", { status: 401 });

    const interaction = JSON.parse(body);

    // رد على PING
    if (interaction.type === 1) return new Response(JSON.stringify({ type: 1 }), { headers: { "Content-Type": "application/json" } });

    // معالجة أمر /search
    if (interaction.type === 2 && interaction.data.name === "search") {
      const query = interaction.data.options.find(opt => opt.name === "query").value;

      try {
        let userId = query;
        let user;

        // 1. إذا المدخل مو أرقام، يعني يبحث بالاسم
        if (isNaN(query)) {
            const nameRes = await fetch(`https://users.roblox.com/v1/usernames/users`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ usernames: [query], excludeBannedUsers: true })
            });
            const nameData = await nameRes.json();
            if (nameData.data.length === 0) throw new Error("User not found");
            userId = nameData.data[0].id;
        }

        // 2. جلب معلومات الحساب
        const userRes = await fetch(`https://users.roblox.com/v1/users/${userId}`);
        if (!userRes.ok) throw new Error("User not found");
        user = await userRes.json();

        // 3. جلب الصورة
        const thumbRes = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png&isCircular=false`);
        const thumbData = await thumbRes.json();
        const avatarUrl = thumbData.data[0]?.imageUrl || "";

        // 4. جلب الحالة (Presence)
        let currentStatus = "Offline";
        let lastOnlineText = "غير متوفر";
        
        const presenceRes = await fetch(`https://presence.roblox.com/v1/presence/users`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userIds: [parseInt(userId)] })
        });
        const presenceData = await presenceRes.json();
        const presence = presenceData.userPresences[0];

        if (presence) {
          if (presence.userPresenceType === 2) {
            currentStatus = `In Game (Place ID: ${presence.placeId})`;
          } else if (presence.userPresenceType === 1) {
            currentStatus = "Online (Website)";
          }
          
          if (presence.lastOnline) {
            lastOnlineText = new Date(presence.lastOnline).toLocaleString('en-US', { timeZone: 'UTC' }) + " (UTC)";
          } else if (presence.userPresenceType === 0) {
            lastOnlineText = "أوفلاين (لا يوجد وقت محدد)";
          }
        }

        const profileLink = `https://www.roblox.com/users/${userId}/profile`;
        const createdDate = new Date(user.created).toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        // 5. بناء الرسالة
        const embed = {
          color: 0x2b2d31,
          author: { name: `${user.name} ( ${user.id} )`, icon_url: avatarUrl },
          title: "Roblox Information",
          url: profileLink, // هذا اللي يخلي العنوان يوديك للملف الشخصي
          description: `**Account Created:** ${createdDate}\n\n**Current Status:** ${currentStatus}\n**Last Online:** ${lastOnlineText}\n\n**[اضغط هنا لفتح الملف الشخصي](${profileLink})**\n\nThe current version of this bot (V2) was created around June 2026, so V2 detections date back to that time.`,
          thumbnail: { url: avatarUrl },
          fields: [{ name: "Connected Accounts", value: "No connected accounts found.", inline: false }]
        };

        // 6. الأزرار
        const components = [
          {
            type: 1,
            components: [
              { type: 2, custom_id: "config_btn", label: "Search Configuration", style: 1 },
              { type: 2, style: 5, label: "Roblox Profile", url: profileLink } // زر يفتح الرابط
            ]
          }
        ];

        return new Response(JSON.stringify({
          type: 4,
          data: { embeds: [embed], components: components }
        }), { headers: { "Content-Type": "application/json" } });

      } catch (error) {
        return new Response(JSON.stringify({
          type: 4, data: { content: "ما لقيت الحساب، تأكد من الاسم أو الآي دي.", flags: 64 }
        }), { headers: { "Content-Type": "application/json" } });
      }
    }

    return new Response("Unknown", { status: 400 });
  }
};

// دالة التحقق من التوقيع
async function verifySignature(body, signature, timestamp, publicKeyHex) {
  const encoder = new TextEncoder();
  const message = encoder.encode(timestamp + body);
  const hexToUint8Array = (hex) => new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
  const key = await crypto.subtle.importKey("raw", hexToUint8Array(publicKeyHex), { name: "Ed25519", namedCurve: "Ed25519" }, false, ["verify"]);
  return await crypto.subtle.verify({ name: "Ed25519" }, key, hexToUint8Array(signature), message);
}
