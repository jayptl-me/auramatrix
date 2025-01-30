import express from 'express';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import axios from "axios";
import cors from 'cors';
import Groq from 'groq-sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3000;

app.use(cors({
  origin: ['https://aura-matrix.vercel.app', 'http://localhost:5500', 'http://127.0.0.1:5500', 'http://localhost:3000']
}));
app.use(express.json());

// Static files
app.use(express.static("public"));

const NVIDIA_API_URL = "https://ai.api.nvidia.com/v1/genai/stabilityai/stable-diffusion-xl";
const NVIDIA_API_KEY = process.env.NVIDIA;

async function generateImage(prompt, attempt = 0) {
  const payload = {
    prompt: prompt, // BRIA 2.3 uses direct prompt string
    aspect_ratio: '1:1',
    mode: 'text-to-image',
    negative_prompt: 'Avoid overly complex designs, cluttered backgrounds, soft or pastel colors, cartoonish or childlike features, unrealistic proportions, flat or dull textures, lack of symmetry, and excessive accessories. Do not include text, logos, or unrelated objects.',
    model: 'bria-2.3',
    seed: '000000', // Better to randomize seed
    output_format: 'jpeg',
    cfg_scale: 9,
    steps: 30
  };

  try {
    const response = await axios({
      method: "POST",
      url: NVIDIA_API_URL,
      headers: {
        Authorization: `Bearer ${NVIDIA_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      data: payload
    });

    // Handle BRIA 2.3 response format
    if (response.data.finish_reason === 'CONTENT_FILTERED') {
      throw new Error('Content filtered by safety system');
    }

    if (!response.data.image) {
      throw new Error('No image data in response');
    }

    // Return as data URL with correct JPEG MIME type
    return `data:image/jpeg;base64,${response.data.image}`;

  } catch (error) {
    console.error(`Error generating image (attempt ${attempt}):`, error.response?.data || error.message);

    if (attempt < 2) { // Retry up to 3 times
      await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
      return generateImage(prompt, attempt + 1);
    }

    throw error;
  }
}

app.post('/api/generate-stickers', async (req, res) => {
  try {
    const { personalityType, gender = 'neutral' } = req.body;
    if (!personalityType) {
      return res.status(400).json({
        error: 'personalityType is required',
        details: 'Personality type must be provided to generate stickers'
      });
    }

    const roleMatch = personalityType.match(/\((.*?)\)/);
    const role = roleMatch ? roleMatch[1] : personalityType;

    const prompts = [
      `A detailed, minimalist-style sticker of ${personalityType}} personality with a black background. Depict a powerful yet sleek design, emphasizing bold colors and a clean aesthetic for ${gender} `,
      `A detailed, minimalist-style sticker of ${personalityType} personality with a black background. Depict a powerful yet sleek design, emphasizing bold colors and a clean aesthetic for ${gender} `,
      `A detailed, minimalist-style sticker of ${personalityType} personality with a black background. Depict a powerful yet sleek design, emphasizing bold colors and a clean aesthetic for ${gender} `,
      `A detailed, minimalist-style sticker of ${personalityType} personality with a black background. Depict a powerful yet sleek design, emphasizing bold colors and a clean aesthetic for ${gender} `,
    ];

    const stickerPromises = prompts.map((prompt, index) =>
      generateImage(prompt).catch(error => {
        console.error(`Sticker ${index + 1} failed:`, error);
        return null;
      })
    );

    const stickerUrls = await Promise.all(stickerPromises);
    const validUrls = stickerUrls.filter(url => url !== null);

    res.json({
      images: validUrls,
      generatedCount: validUrls.length,
      message: validUrls.length === 4 ? 'All stickers generated' : 'Partial generation completed'
    });
  }
  catch (error) {
    console.error('Unexpected error in sticker generation:', error);
    res.status(500).json({
      error: 'Unexpected error in sticker generation',
      details: error.message
    });
  }
});


app.post('/predict', async (req, res) => {
  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const { answers } = req.body;

    if (!Array.isArray(answers)) {
      throw new Error('Answers must be an array');
    }

    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `
          You are a highly advanced Personality Predictor AI designed to accurately analyze user responses to personality-related questions and determine their personality type.\n
          Your analysis is based on the 16-personality system (MBTI), and you are expected to assign percentages to key personality traits for Extraversion/Introversion, Intuition/Sensing, Thinking/Feeling, and Judging/Perceiving.\n
          Provide concise and accurate predictions even for nuanced or complex responses.\n
          Use the tone and sentiment of answers alongside inferred behavioral patterns to determine each personality trait's percentage.\n
          `,
        },
        {
          role: "user",
          content: `
          The user has provided the following responses to personality-related questions:\n
          
          1. **How do you feel about trying new and unconventional activities?**\n
             Answer: ${answers[0]}\n
          2. **When you're in a group, how do you usually behave?**\n
             Answer: ${answers[1]}\n
          3. **How do you handle criticism?**\n
             Answer: ${answers[2]}\n
          4. **How do you approach planning for the future?**\n
             Answer: ${answers[3]}\n
          5. **How do you feel about helping others?**\n
             Answer: ${answers[4]}\n
          6. **How do you react when faced with a challenging problem?**\n
             Answer: ${answers[5]}\n
          7. **How do you feel about expressing your opinions in a group?**\n
             Answer: ${answers[6]}\n
          8. **How do you handle deadlines?**\n
             Answer: ${answers[7]}\n
          9. **How do you feel about people who are very different from you?**\n
             Answer: ${answers[8]}\n
          10. **How do you feel about taking risks?**\n
              Answer: ${answers[9]}\n


          Analyze the following:
          1. Look for specific keywords, behavioral tendencies, and sentiment in each answer to determine the dominant and secondary traits.\n
          2. Use context and emotional cues to provide an accurate breakdown of the personality traits.\n
          3. If the input contains random gibberish, nonsensical characters, or unintelligible responses that cannot be interpreted or mapped to a valid personality type, return an 'Unknown' personality type with all traits set to 0%.\n
      
          Task: Predict the personality type and assign percentages to the traits:
          - Extraversion/Introversion
          - Intuition/Sensing
          - Thinking/Feeling
          - Judging/Perceiving
      
          Expected output (ONLY a JSON object):
          {
            "personalityType": "INTJ (Architect)",
            "traits": {
              "Extraversion": 75,
              "Intuition": 85,
              "Thinking": 65,
              "Judging": 70
            }
          }

          If the user's input consists of random gibberish, nonsensical characters, or unintelligible responses that cannot be interpreted or mapped to a valid personality type, return the following JSON structure:
          {
            "personalityType": "Unknown",
            "traits": {
              "Unclear Trait 1": 0,
              "Unclear Trait 2": 0,
              "Unclear Trait 3": 0,
              "Unclear Trait 4": 0
            }
          }
          `,
        },
      ],
      model: "llama3-70b-8192",
      max_tokens: 100,
      temperature: 0,
    });
    const content = chatCompletion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No prediction received from AI');
    }
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Invalid prediction format');
    }
    const prediction = JSON.parse(jsonMatch[0]);
    res.json({ prediction });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to predict personality' });
  }
});

app.post('/extra-info', async (req, res) => {
  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const { answers, personalityType } = req.body;

    if (!Array.isArray(answers) || !personalityType) {
      return res.status(400).json({
        error: 'Invalid request data',
        details: 'Both answers array and personalityType are required'
      });
    }

    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `
          You are a highly advanced Personality Predictor AI specializing in mapping user responses to the 16 Personality System (MBTI).\n
      Your task is to create a Personality Matrix based on the user's responses. The matrix will align with the MBTI framework, including Extraversion (E)/Introversion (I), Sensing (S)/Intuition (N), Thinking (T)/Feeling (F), and Judging (J)/Perceiving (P).\n
      Analyze each response based on the keywords, tone, and behavioral patterns to determine how strongly it correlates with each MBTI trait.\n
      Provide accurate and consistent results.\n
          `,
        },
        {
          role: "user",
          content: `
          The user's personality is ${personalityType}. Based on the user's answers, create a Personality Matrix aligned with the 16 Personality System (MBTI).\n
      User's Answers: ${answers}\n

      Matrix layout:\n
      | Answer | Extraversion (E)/Introversion (I) | Sensing (S)/Intuition (N) | Thinking (T)/Feeling (F) | Judging (J)/Perceiving (P) |\n
      |--------|-----------------------------------|---------------------------|--------------------------|----------------------------|\n
      | ans1   | cell1                             | cell2                     | cell3                    | cell4                      |\n
      | ans2   | cell5                             | cell6                     | cell7                    | cell8                      |\n
      | ans3   | cell9                             | cell10                    | cell11                   | cell12                     |\n
      | ans4   | cell13                            | cell14                    | cell15                   | cell16                     |\n
      | ans5   | cell17                            | cell18                    | cell19                   | cell20                     |\n
      | ans6   | cell21                            | cell22                    | cell23                   | cell24                     |\n
      | ans7   | cell25                            | cell26                    | cell27                   | cell28                     |\n
      | ans8   | cell29                            | cell30                    | cell31                   | cell32                     |\n
      | ans9   | cell33                            | cell34                    | cell35                   | cell36                     |\n
      | ans10  | cell37                            | cell38                    | cell39                   | cell40                     |\n

      Guidelines for assigning cells:\n
      1. For each answer, assess whether it demonstrates a preference for one trait over another (e.g., high E for extroverted responses, high T for logical responses).\n
      2. Assign "None" for traits that are not clearly indicated by the answer.\n
      3. Use patterns from the provided example matrix for consistency in analysis.\n
      4. Ensure the traits assigned are directly aligned with the context and wording of the answer.\n
      5. Avoid randomness; consistency and accuracy are top priorities.\n
      6. Only use "High X" when answer clearly demonstrates that trait\

      Example Matrix:\n
      | Answer                                     | Extraversion (E)/Introversion (I) | Sensing (S)/Intuition (N) | Thinking (T)/Feeling (F) | Judging (J)/Perceiving (P) |\n
      |--------------------------------------------|-----------------------------------|---------------------------|--------------------------|----------------------------|\n
      | I like trying new things.                  | None                              | High N (Intuition)        | None                     | High P (Perceiving)        |\n
      | I usually lead in groups.                  | High E (Extraversion)             | None                      | None                     | None                       |\n
      | I take criticism well.                     | None                              | None                      | High T (Thinking)        | None                       |\n
      | I plan for the future.                     | None                              | None                      | None                     | High J (Judging)           |\n
      | I enjoy helping others.                    | None                              | None                      | High F (Feeling)         | None                       |\n
      | I solve problems logically.                | High I (Introversion)             | None                      | High T (Thinking)        | None                       |\n
      | I express my opinions clearly.             | High E (Extraversion)             | None                      | None                     | None                       |\n
      | I meet deadlines.                          | None                              | None                      | None                     | High J (Judging)           |\n
      | I get along with different people.         | None                              | None                      | High F (Feeling)         | None                       |\n
      | I take calculated risks.                   | High E (Extraversion)             | High N (Intuition)        | None                     | None                       |\n

      Task: Create the matrix based on the user's answers, ensuring alignment with the above guidelines.

      Expected output (ONLY a JSON object):
      {
        "values": {
          "cell1": ,
          "cell2": ,
          "cell3": ,
          "cell4": ,
          "cell5": ,
          "cell6": ,
          "cell7": ,
          "cell8": ,
          "cell9": ,
          "cell10": ,
          "cell11": ,
          "cell12": ,
          "cell13": ,
          "cell14": ,
          "cell15": ,
          "cell16": ,
          "cell17": ,
          "cell18": ,
          "cell19": ,
          "cell20": ,
          "cell21": ,
          "cell22": ,
          "cell23": ,
          "cell24": ,
          "cell25": ,
          "cell26": ,
          "cell27": ,
          "cell28": ,
          "cell29": ,
          "cell30": ,
          "cell31": ,
          "cell32": ,
          "cell33": ,
          "cell34": ,
          "cell35": ,
          "cell36": ,
          "cell37": ,
          "cell38": ,
          "cell39": ,
          "cell40": ,
        }
      }
      `},
      ],
      model: "llama3-70b-8192",
      max_tokens: 700,
      temperature: 0,
    });
    const content = chatCompletion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No prediction received from AI');
    }
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Invalid prediction format');
    }
    const prediction = JSON.parse(jsonMatch[0]);
    res.json({ prediction });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to predict personality', details: error.message });
  }
});

app.post('/description', async (req, res) => {
  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const { personalityType } = req.body;

    if (!personalityType) {
      return res.status(400).json({
        error: 'Invalid request data',
        details: 'personalityType is required'
      });
    }

    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `
        You are a Personality Predictor AI trained to analyze user responses and predict personality types.\n
        Your task is to create a pesonality description according users personality.\n
        `,
        },
        // In the '/description' endpoint's user message content:
        {
          role: "user",
          content: `
            User's personality is ${personalityType}. Create a personality description using valid JSON syntax (no markdown). Follow this structure:
            Expected output (ONLY valid JSON):
            {
              "description": "ENFJs, known as Protagonists, are charismatic...",
              "examples": [
                "Oprah Winfrey",
                "Barack Obama",
                "Jennifer Lawrence",
                "Martin Luther King Jr."
              ]
            }
            `
        }
      ],
      model: "llama3-70b-8192",
      max_tokens: 700,
      temperature: 0,
    });
    const content = chatCompletion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No prediction received from AI');
    }
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Invalid prediction format');
    }
    const prediction = JSON.parse(jsonMatch[0]);
    res.json({ prediction });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to predict personality', details: error.message });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);

});