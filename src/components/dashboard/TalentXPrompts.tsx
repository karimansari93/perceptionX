import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { generateTalentXPrompts, getPromptsByAttribute, getPromptsByType, TALENTX_ATTRIBUTES } from '@/config/talentXAttributes';
import { Copy, Check, Star, TrendingUp, Target } from 'lucide-react';

interface TalentXPromptsProps {
  companyName: string;
  industry: string;
  onPromptSelect?: (prompt: string) => void;
}

export const TalentXPrompts = ({ companyName, industry, onPromptSelect }: TalentXPromptsProps) => {
  const [selectedAttribute, setSelectedAttribute] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);

  const allPrompts = generateTalentXPrompts(companyName, industry);
  
  // Filter prompts based on selection
  const filteredPrompts = allPrompts.filter(prompt => {
    const attributeMatch = selectedAttribute === 'all' || prompt.attributeId === selectedAttribute;
    const typeMatch = selectedType === 'all' || prompt.type === selectedType;
    return attributeMatch && typeMatch;
  });

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'sentiment':
        return <Star className="w-4 h-4 text-blue-600" />;
      case 'competitive':
        return <TrendingUp className="w-4 h-4 text-green-600" />;
      case 'visibility':
        return <Target className="w-4 h-4 text-purple-600" />;
      default:
        return null;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'sentiment':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'competitive':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'visibility':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'sentiment':
        return 'Sentiment';
      case 'competitive':
        return 'Competitive';
      case 'visibility':
        return 'Visibility';
      default:
        return type;
    }
  };

  const handleCopyPrompt = async (prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedPrompt(prompt);
      setTimeout(() => setCopiedPrompt(null), 2000);
    } catch (err) {
      console.error('Failed to copy prompt:', err);
    }
  };

  const handleSelectPrompt = (prompt: string) => {
    if (onPromptSelect) {
      onPromptSelect(prompt);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-2">TalentX Prompts</h3>
        <p className="text-gray-600">
          30 specialized prompts to analyze your company's talent attraction attributes across sentiment, competitive analysis, and industry visibility.
        </p>
      </div>

      {/* Filter Controls */}
      <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-3">
        <Select
          value={selectedAttribute}
          onValueChange={setSelectedAttribute}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="All Attributes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Attributes</SelectItem>
            {TALENTX_ATTRIBUTES.map(attr => (
              <SelectItem key={attr.id} value={attr.id}>{attr.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        
        <Select
          value={selectedType}
          onValueChange={setSelectedType}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="sentiment">Sentiment</SelectItem>
            <SelectItem value="competitive">Competitive</SelectItem>
            <SelectItem value="visibility">Visibility</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-blue-600">{allPrompts.length}</p>
              <p className="text-sm text-gray-600">Total Prompts</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600">{allPrompts.filter(p => p.type === 'sentiment').length}</p>
              <p className="text-sm text-gray-600">Sentiment</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-purple-600">{allPrompts.filter(p => p.type === 'competitive').length}</p>
              <p className="text-sm text-gray-600">Competitive</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-orange-600">{allPrompts.filter(p => p.type === 'visibility').length}</p>
              <p className="text-sm text-gray-600">Visibility</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Prompts Display */}
      <Tabs defaultValue="grid" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="grid">Grid View</TabsTrigger>
          <TabsTrigger value="list">List View</TabsTrigger>
        </TabsList>

        <TabsContent value="grid" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPrompts.map((prompt, index) => (
              <Card key={index} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {getTypeIcon(prompt.type)}
                      <Badge variant="outline" className={getTypeColor(prompt.type)}>
                        {getTypeLabel(prompt.type)}
                      </Badge>
                    </div>
                  </div>
                  <CardTitle className="text-sm font-medium">
                    {prompt.attribute?.name}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-700 mb-4 line-clamp-4">
                    {prompt.prompt}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleCopyPrompt(prompt.prompt)}
                      className="flex-1"
                    >
                      {copiedPrompt === prompt.prompt ? (
                        <Check className="w-4 h-4 mr-2" />
                      ) : (
                        <Copy className="w-4 h-4 mr-2" />
                      )}
                      {copiedPrompt === prompt.prompt ? 'Copied!' : 'Copy'}
                    </Button>
                    {onPromptSelect && (
                      <Button
                        size="sm"
                        onClick={() => handleSelectPrompt(prompt.prompt)}
                        className="flex-1"
                      >
                        Use Prompt
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="list" className="space-y-4">
          <div className="space-y-4">
            {filteredPrompts.map((prompt, index) => (
              <Card key={index} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        {getTypeIcon(prompt.type)}
                        <Badge variant="outline" className={getTypeColor(prompt.type)}>
                          {getTypeLabel(prompt.type)}
                        </Badge>
                        <span className="text-sm font-medium text-gray-600">
                          {prompt.attribute?.name}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700">
                        {prompt.prompt}
                      </p>
                    </div>
                    <div className="flex gap-2 ml-4">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCopyPrompt(prompt.prompt)}
                      >
                        {copiedPrompt === prompt.prompt ? (
                          <Check className="w-4 h-4 mr-2" />
                        ) : (
                          <Copy className="w-4 h-4 mr-2" />
                        )}
                        {copiedPrompt === prompt.prompt ? 'Copied!' : 'Copy'}
                      </Button>
                      {onPromptSelect && (
                        <Button
                          size="sm"
                          onClick={() => handleSelectPrompt(prompt.prompt)}
                        >
                          Use
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {filteredPrompts.length === 0 && (
        <div className="text-center py-8">
          <p className="text-gray-500">No prompts match the selected filters.</p>
        </div>
      )}
    </div>
  );
}; 