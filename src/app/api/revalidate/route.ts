import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';

export async function POST(req: NextRequest) {
  try {
    const { path, tag } = await req.json();

    if (path) {
      revalidatePath(path);
      return NextResponse.json({ revalidated: true, type: 'path', value: path });
    }

    if (tag) {
      revalidateTag(tag);
      return NextResponse.json({ revalidated: true, type: 'tag', value: tag });
    }

    return NextResponse.json({ error: 'Missing path or tag parameter' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: 'Failed to revalidate cache', details: error.message }, { status: 500 });
  }
}
