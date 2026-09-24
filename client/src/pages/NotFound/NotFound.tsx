import React from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';

const NotFound: React.FC = () => (
  <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background px-4 text-center">
    <h1 className="text-2xl font-semibold">页面不存在</h1>
    <p className="text-sm text-muted-foreground">请检查链接或返回工作台。</p>
    <Button asChild><Link to="/">返回工作台</Link></Button>
  </main>
);

export default NotFound;
